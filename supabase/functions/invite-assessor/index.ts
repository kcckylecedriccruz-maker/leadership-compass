import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { hasModule } from "../_shared/access.ts";
import { ExternalRaterError, findOrCreateExternal, linkExternalToEmployee } from "../_shared/externalRaters.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const CLASSIFICATIONS = [
  "self",
  "immediate_manager",
  "skip_level_manager",
  "direct_report",
  "skip_level_report",
  "peer",
  "external",
] as const;
type Classification = (typeof CLASSIFICATIONS)[number];

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

class RequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type Admin = SupabaseClient;

type Caller = { id: string; role: string };

async function requireCaller(admin: Admin, req: Request): Promise<Caller> {
  const header = req.headers.get("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) throw new RequestError(401, "Please sign in again.");

  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) throw new RequestError(401, "Please sign in again.");

  const { data: profile, error } = await admin
    .from("profiles")
    .select("id, role, is_active")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (error) throw new Error(`Could not load caller profile: ${error.message}`);
  if (!profile) throw new RequestError(403, "Your account is not set up for this action.");
  // Edit access to Assignments lets a non-admin add assessors for any talent, like an admin.
  const canEditAll = await hasModule(
    admin,
    { id: profile.id, email: "", role: profile.role, isActive: profile.is_active !== false },
    "assignments",
    "edit",
  );
  return { id: profile.id, role: canEditAll ? "admin" : profile.role };
}

type Input = {
  cycleId: string;
  talentId: string;
  classification: Classification;
  assessorEmail: string | null;
  assessorName: string | null;
  organisation: string | null;
};

function parseInput(body: unknown): Input {
  if (typeof body !== "object" || body === null) throw new RequestError(400, "The request was not understood.");
  const raw = body as Record<string, unknown>;

  const cycleId = typeof raw.cycle_id === "string" ? raw.cycle_id : "";
  const talentId = typeof raw.talent_id === "string" ? raw.talent_id : "";
  if (!UUID_PATTERN.test(cycleId) || !UUID_PATTERN.test(talentId)) {
    throw new RequestError(400, "Choose a cycle and a talent.");
  }

  const classification = raw.classification;
  if (typeof classification !== "string" || !(CLASSIFICATIONS as readonly string[]).includes(classification)) {
    throw new RequestError(400, "Choose an assessor type.");
  }

  const email = typeof raw.assessor_email === "string" ? raw.assessor_email.trim().toLowerCase() : "";
  if (email && (!EMAIL_PATTERN.test(email) || email.length > 254)) {
    throw new RequestError(400, "Enter a valid email address for the assessor.");
  }

  const name = typeof raw.assessor_name === "string" ? raw.assessor_name.trim() : "";
  if (name.length > 200) throw new RequestError(400, "The assessor's name is too long.");
  const organisation = typeof raw.organisation === "string" ? raw.organisation.trim() : "";
  if (organisation.length > 100) throw new RequestError(400, "The organisation can be up to 100 characters.");

  return {
    cycleId,
    talentId,
    classification: classification as Classification,
    assessorEmail: email || null,
    assessorName: name || null,
    organisation: organisation || null,
  };
}

type TalentRow = {
  id: string;
  profile_id: string;
  profile: { full_name: string; email: string };
};

async function loadTalent(admin: Admin, talentId: string): Promise<TalentRow> {
  const { data, error } = await admin
    .from("talents")
    .select("id, profile_id, profile:profiles!profile_id(full_name, email)")
    .eq("id", talentId)
    .maybeSingle();
  if (error) throw new Error(`Could not load talent: ${error.message}`);
  if (!data) throw new RequestError(404, "This talent could not be found.");
  return data as unknown as TalentRow;
}

async function loadManagerIds(admin: Admin, talentId: string): Promise<string[]> {
  const { data, error } = await admin.from("talent_managers").select("manager_profile_id").eq("talent_id", talentId);
  if (error) throw new Error(`Could not load managers: ${error.message}`);
  return (data ?? []).map((row) => row.manager_profile_id as string);
}

async function loadCycleStatus(admin: Admin, cycleId: string): Promise<string> {
  const { data, error } = await admin.from("cycles").select("status").eq("id", cycleId).maybeSingle();
  if (error) throw new Error(`Could not load cycle: ${error.message}`);
  if (!data) throw new RequestError(404, "This cycle could not be found.");
  return data.status;
}

async function createAccount(admin: Admin, email: string, fullName: string): Promise<{ id: string }> {
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (error || !data.user) {
    if (error?.message.toLowerCase().includes("already")) {
      throw new RequestError(409, "An account already exists for this email without a profile. Contact support.");
    }
    throw new Error(`Could not create auth user: ${error?.message ?? "unknown error"}`);
  }

  const { error: profileError } = await admin.from("profiles").insert({
    id: data.user.id,
    full_name: fullName,
    email,
    role: "employee",
    must_change_password: false,
  });
  if (profileError) {
    await admin.auth.admin.deleteUser(data.user.id);
    throw new Error(`Could not create profile: ${profileError.message}`);
  }
  return { id: data.user.id };
}

type Assessor = {
  id: string;
  email: string;
  fullName: string;
  needsActivation: boolean;
};

async function profileById(
  admin: Admin,
  profileId: string,
): Promise<{ id: string; email: string; full_name: string; activated_at: string | null }> {
  const { data, error } = await admin
    .from("profiles")
    .select("id, email, full_name, activated_at")
    .eq("id", profileId)
    .maybeSingle();
  if (error) throw new Error(`Could not load profile: ${error.message}`);
  if (!data) throw new RequestError(400, "The selected person does not have an account.");
  return data;
}

async function resolveAssessor(admin: Admin, talent: TalentRow, managerIds: string[], input: Input): Promise<Assessor> {
  if (input.classification === "self") {
    const profile = await profileById(admin, talent.profile_id);
    return { id: profile.id, email: profile.email, fullName: profile.full_name, needsActivation: profile.activated_at === null };
  }

  if (input.classification === "immediate_manager") {
    throw new RequestError(409, "Immediate managers are assessors automatically for every open and draft cycle.");
  }

  if (!input.assessorEmail) throw new RequestError(400, "Enter the assessor's email address.");
  if (input.assessorEmail === talent.profile.email) {
    throw new RequestError(400, "The talent cannot be an assessor in this role.");
  }

  if (input.classification === "external") {
    // External raters never get a usable account; they answer by secure link.
    const rater = await findOrCreateExternal(admin, {
      email: input.assessorEmail,
      fullName: input.assessorName ?? "",
      organisation: input.organisation,
    });
    return { id: rater.id, email: rater.email, fullName: rater.fullName, needsActivation: true };
  }

  const { data: existing, error } = await admin
    .from("profiles")
    .select("id, email, full_name, activated_at, person_type")
    .eq("email", input.assessorEmail)
    .maybeSingle();
  if (error) throw new Error(`Could not look up assessor: ${error.message}`);

  if (existing) {
    if (existing.person_type === "external") {
      throw new RequestError(400, "This is an external rater. Choose the External type for them.");
    }
    if (managerIds.includes(existing.id)) {
      throw new RequestError(400, "The immediate manager uses the Immediate manager type.");
    }
    return { id: existing.id, email: existing.email, fullName: existing.full_name, needsActivation: existing.activated_at === null };
  }

  if (!input.assessorName) {
    throw new RequestError(400, "Enter the assessor's name so we can create their account.");
  }
  const account = await createAccount(admin, input.assessorEmail, input.assessorName);
  return {
    id: account.id,
    email: input.assessorEmail,
    fullName: input.assessorName,
    needsActivation: true,
  };
}

async function sendInvite(
  cycleId: string,
  talentId: string,
  assignmentId: string,
  assessor: Assessor,
): Promise<boolean> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const internalSecret = Deno.env.get("INTERNAL_SECRET");
  if (!supabaseUrl || !internalSecret) {
    console.error("Invite not sent: INTERNAL_SECRET is not configured.");
    return false;
  }

  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-secret": internalSecret },
      // The invite carries the secure link for anyone without an active account.
      body: JSON.stringify({
        type: "invite",
        recipient_email: assessor.email,
        assignment_id: assignmentId,
        cycle_id: cycleId,
        talent_id: talentId,
      }),
    });
    if (!response.ok) {
      console.error(`Invite email responded with status ${response.status}`);
      return false;
    }
    return true;
  } catch (error) {
    console.error("Invite email request failed:", error instanceof Error ? error.message : error);
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    const caller = await requireCaller(admin, req);
    const input = parseInput(await req.json().catch(() => null));
    const talent = await loadTalent(admin, input.talentId);
    const cycleStatus = await loadCycleStatus(admin, input.cycleId);

    const managerIds = await loadManagerIds(admin, input.talentId);
    const isAdmin = caller.role === "admin";
    if (!isAdmin && !managerIds.includes(caller.id)) {
      throw new RequestError(403, "You can only add assessors for talents you manage.");
    }
    if (cycleStatus === "closed") {
      throw new RequestError(409, "This cycle has closed, so assessors can no longer be added.");
    }

    const assessor = await resolveAssessor(admin, talent, managerIds, input);

    const { data: assignment, error: insertError } = await admin
      .from("assignments")
      .insert({
        cycle_id: input.cycleId,
        talent_id: input.talentId,
        assessor_id: assessor.id,
        classification: input.classification,
        origin: input.classification === "external" ? "external" : "manual",
      })
      .select("id")
      .single();
    if (insertError) {
      if (insertError.code === "23505") {
        throw new RequestError(409, "This person is already assigned to this talent in this cycle.");
      }
      throw new Error(`Could not create assignment: ${insertError.message}`);
    }

    const { error: auditError } = await admin.from("audit_log").insert({
      actor_id: caller.id,
      action: "assignment.added",
      entity: "assignment",
      entity_id: assignment.id,
      details: {
        cycle_id: input.cycleId,
        talent_id: input.talentId,
        assessor_id: assessor.id,
        classification: input.classification,
        needs_activation: assessor.needsActivation,
      },
    });
    if (auditError) {
      await admin.from("assignments").delete().eq("id", assignment.id);
      throw new Error(`Could not record the change: ${auditError.message}`);
    }

    if (input.classification === "external") {
      // Keep them on the employee so they carry over to future cycles.
      await linkExternalToEmployee(admin, talent.profile_id, assessor.id, caller.id);
    }

    // Draft cycles send invitations when they open.
    if (cycleStatus !== "open") {
      return json({ assignment_id: assignment.id, email_sent: false, waiting_for_open: true }, 201);
    }
    const emailSent = await sendInvite(input.cycleId, input.talentId, assignment.id, assessor);
    if (emailSent) {
      await admin.from("assignments").update({ last_reminded_at: new Date().toISOString() }).eq("id", assignment.id);
    }

    return json(
      {
        assignment_id: assignment.id,
        email_sent: emailSent,
      },
      201,
    );
  } catch (error) {
    if (error instanceof RequestError || error instanceof ExternalRaterError) return json({ error: error.message }, error.status);
    console.error("invite-assessor failed:", error instanceof Error ? error.message : error);
    return json({ error: "Something went wrong while adding this assessor. Please try again." }, 500);
  }
});
