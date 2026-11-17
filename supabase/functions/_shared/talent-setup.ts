import type { SupabaseClient } from "npm:@supabase/supabase-js@2.57.4";
import { AccessError, callerFromRequest, hasModule } from "./access.ts";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class RequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export type Admin = SupabaseClient;

export type Profile = { id: string; email: string; full_name: string };

export function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Adding talents needs edit access to the Talents module (admins always have it).
export async function requireAdmin(admin: Admin, req: Request): Promise<string> {
  try {
    const caller = await callerFromRequest(admin, req);
    if (!(await hasModule(admin, caller, "talents", "edit"))) {
      throw new RequestError(403, "You need edit access to Talents to add talents.");
    }
    return caller.id;
  } catch (error) {
    if (error instanceof AccessError) throw new RequestError(error.status, error.message);
    throw error;
  }
}

export async function loadProfile(admin: Admin, profileId: string): Promise<Profile> {
  const { data, error } = await admin
    .from("profiles")
    .select("id, email, full_name")
    .eq("id", profileId)
    .maybeSingle();
  if (error) throw new Error(`Could not load profile: ${error.message}`);
  if (!data) throw new RequestError(400, "The selected person could not be found.");
  return data;
}

export async function findTalentId(admin: Admin, profileId: string): Promise<string | null> {
  const { data, error } = await admin.from("talents").select("id").eq("profile_id", profileId).maybeSingle();
  if (error) throw new Error(`Could not check talents: ${error.message}`);
  return data?.id ?? null;
}

export type ManagerSelection = { managerIds: string[]; primaryManagerId: string | null };

export async function insertTalent(
  admin: Admin,
  callerId: string,
  details: {
    profileId: string;
    managers: ManagerSelection;
    department: string | null;
    position: string | null;
    existingPerson: boolean;
  },
): Promise<string> {
  const { data: talent, error } = await admin
    .from("talents")
    .insert({
      profile_id: details.profileId,
      department: details.department,
      position: details.position,
    })
    .select("id")
    .single();
  if (error) throw new Error(`Could not create talent: ${error.message}`);

  if (details.managers.managerIds.length > 0) {
    const { error: managersError } = await admin.from("talent_managers").insert(
      details.managers.managerIds.map((managerId) => ({
        talent_id: talent.id,
        manager_profile_id: managerId,
        is_primary: managerId === details.managers.primaryManagerId,
      })),
    );
    if (managersError) throw new Error(`Could not record managers: ${managersError.message}`);
  }

  const { error: auditError } = await admin.from("audit_log").insert({
    actor_id: callerId,
    action: "talent.created",
    entity: "talent",
    entity_id: talent.id,
    details: {
      profile_id: details.profileId,
      manager_ids: details.managers.managerIds,
      primary_manager_id: details.managers.primaryManagerId,
      department: details.department,
      position: details.position,
      existing_person: details.existingPerson,
    },
  });
  if (auditError) throw new Error(`Could not record talent creation: ${auditError.message}`);
  return talent.id;
}

export async function removeTalentSetup(admin: Admin, talentId: string): Promise<void> {
  await admin.from("assignments").delete().eq("talent_id", talentId);
  await admin.from("talents").delete().eq("id", talentId);
}

export async function addSelfAssessments(
  admin: Admin,
  callerId: string,
  talentId: string,
  profileId: string,
): Promise<string[]> {
  const { data: cycles, error } = await admin.from("cycles").select("id, name").in("status", ["open", "draft"]);
  if (error) throw new Error(`Could not load cycles: ${error.message}`);
  if (!cycles || cycles.length === 0) return [];

  const { data: assignments, error: insertError } = await admin
    .from("assignments")
    .insert(
      cycles.map((cycle) => ({
        cycle_id: cycle.id,
        talent_id: talentId,
        assessor_id: profileId,
        classification: "self",
      })),
    )
    .select("id, cycle_id");
  if (insertError) throw new Error(`Could not create Self assessments: ${insertError.message}`);

  const { error: auditError } = await admin.from("audit_log").insert(
    (assignments ?? []).map((assignment) => ({
      actor_id: callerId,
      action: "assignment.added",
      entity: "assignment",
      entity_id: assignment.id,
      details: { cycle_id: assignment.cycle_id, talent_id: talentId, assessor_id: profileId, classification: "self" },
    })),
  );
  if (auditError) throw new Error(`Could not record Self assessments: ${auditError.message}`);

  return cycles.map((cycle) => cycle.name);
}

// The database creates the Immediate manager assignments; this only sends their invite emails.
export async function notifyManagerAssignments(admin: Admin, talentId: string): Promise<string[]> {
  const { data, error } = await admin
    .from("assignments")
    .select("id, cycle_id, talent_id, cycles!inner(name, status), assessor:profiles!assessor_id(email, activated_at)")
    .eq("talent_id", talentId)
    .eq("classification", "immediate_manager")
    .in("cycles.status", ["open", "draft"]);
  if (error) throw new Error(`Could not load manager assignments: ${error.message}`);

  const failedCycles: string[] = [];
  for (const row of (data ?? []) as unknown as ManagerAssignmentRow[]) {
    const sent = await sendInviteEmail(row);
    if (!sent) failedCycles.push(row.cycles.name);
  }
  return failedCycles;
}

type ManagerAssignmentRow = {
  id: string;
  cycle_id: string;
  talent_id: string;
  cycles: { name: string; status: string };
  assessor: { email: string; activated_at: string | null } | null;
};

async function sendInviteEmail(row: ManagerAssignmentRow): Promise<boolean> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const internalSecret = Deno.env.get("INTERNAL_SECRET");
  const email = row.assessor?.email;
  if (!supabaseUrl || !internalSecret || !email) return false;
  const body = row.assessor?.activated_at === null
    ? { type: "account_invite", recipient_email: email }
    : { type: "invite", recipient_email: email, assignment_id: row.id, cycle_id: row.cycle_id, talent_id: row.talent_id };
  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-secret": internalSecret },
      body: JSON.stringify(body),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function sendTalentAddedEmail(email: string): Promise<boolean> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const internalSecret = Deno.env.get("INTERNAL_SECRET");
  if (!supabaseUrl || !internalSecret) {
    console.error("Talent notice not sent: INTERNAL_SECRET is not configured.");
    return false;
  }
  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-secret": internalSecret },
      body: JSON.stringify({ type: "talent_added", recipient_email: email }),
    });
    if (!response.ok) console.error(`Talent notice responded with status ${response.status}`);
    return response.ok;
  } catch (error) {
    console.error("Talent notice request failed:", error instanceof Error ? error.message : error);
    return false;
  }
}
