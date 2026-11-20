import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { hasModule } from "../_shared/access.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

async function requireCaller(admin: SupabaseClient, req: Request): Promise<{ id: string; role: string }> {
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
  // Edit access to Users or Assignments can resend any invitation, like an admin.
  const asCaller = { id: profile.id, email: "", role: profile.role, isActive: profile.is_active !== false };
  const canResendAll =
    (await hasModule(admin, asCaller, "users", "edit")) || (await hasModule(admin, asCaller, "assignments", "edit"));
  // Managers (people with direct reports in the org structure) can resend to their own team.
  const { count: reports } = await admin.from("profiles").select("id", { count: "exact", head: true }).eq("manager_id", profile.id);
  if (!canResendAll && (reports ?? 0) === 0) {
    throw new RequestError(403, "Only administrators and managers can resend invitations.");
  }
  return { id: profile.id, role: canResendAll ? "admin" : profile.role };
}

async function managerCanReach(admin: SupabaseClient, managerId: string, profileId: string): Promise<boolean> {
  const { data: asTalent, error: talentError } = await admin
    .from("talents")
    .select("id")
    .eq("profile_id", profileId)
    .eq("immediate_manager_id", managerId)
    .maybeSingle();
  if (talentError) throw new Error(`Could not check talents: ${talentError.message}`);
  if (asTalent) return true;

  const { data: asAssessor, error: assessorError } = await admin
    .from("assignments")
    .select("id, talent:talents!talent_id(immediate_manager_id)")
    .eq("assessor_id", profileId);
  if (assessorError) throw new Error(`Could not check assignments: ${assessorError.message}`);
  return (asAssessor ?? []).some((row) => {
    const talent = row.talent as unknown as { immediate_manager_id: string | null } | null;
    return talent?.immediate_manager_id === managerId;
  });
}

async function sendAccountInvite(email: string): Promise<void> {
  const response = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-internal-secret": Deno.env.get("INTERNAL_SECRET") ?? "" },
    body: JSON.stringify({ type: "account_invite", recipient_email: email }),
  });
  if (!response.ok) throw new Error(`send-email responded with ${response.status}`);
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

    const body = await req.json().catch(() => null);
    const profileId = typeof body?.profile_id === "string" ? body.profile_id : "";
    if (!UUID_PATTERN.test(profileId)) throw new RequestError(400, "Choose a person to invite.");

    const { data: target, error: targetError } = await admin
      .from("profiles")
      .select("id, email, activated_at")
      .eq("id", profileId)
      .maybeSingle();
    if (targetError) throw new Error(`Could not load the profile: ${targetError.message}`);
    if (!target) throw new RequestError(404, "This person could not be found.");

    if (caller.role !== "admin" && !(await managerCanReach(admin, caller.id, profileId))) {
      throw new RequestError(403, "You can only resend invitations to people you manage.");
    }
    if (target.activated_at !== null) {
      throw new RequestError(409, "This person has already created their account.");
    }

    await sendAccountInvite(target.email);
    return json({ message: "The invitation has been sent again." }, 200);
  } catch (error) {
    if (error instanceof RequestError) return json({ error: error.message }, error.status);
    console.error("resend-invite failed:", error instanceof Error ? error.message : error);
    return json({ error: "The invitation could not be sent. Please try again." }, 500);
  }
});
