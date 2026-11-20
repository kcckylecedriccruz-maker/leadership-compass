// Shared account creation, used by create-user (one person) and
// bulk-create-users (an uploaded spreadsheet). One set of rules for both:
// - the password is random and never shown; the person sets their own through
//   the invitation and a 6-digit activation code,
// - only administrators create administrators or grant module access,
// - every account is written to the audit trail.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2.57.4";
import type { Caller, Module } from "./access.ts";

export const ROLES = ["admin", "employee"] as const;
export type Role = (typeof ROLES)[number];
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type NewUser = {
  fullName: string;
  email: string;
  role: Role;
  access: { module: Module; level: "view" | "edit" }[];
  groups: string[];
  sendInvite: boolean;
  department?: string | null;
  position?: string | null;
  /** Immediate manager in the org structure. */
  managerId?: string | null;
};

export type CreateOutcome =
  | { ok: true; id: string; inviteSent: boolean; groups: string[] }
  | { ok: false; status: number; error: string };

function randomPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes));
}

export async function sendInvite(email: string): Promise<boolean> {
  const internalSecret = Deno.env.get("INTERNAL_SECRET");
  if (!internalSecret) return false;
  try {
    const response = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-secret": internalSecret },
      body: JSON.stringify({ type: "account_invite", recipient_email: email }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** Finds groups by name (case-insensitive) and creates the missing ones. Returns name -> id. */
export async function ensureGroups(
  admin: SupabaseClient,
  callerId: string,
  names: string[],
): Promise<Map<string, { id: string; name: string }>> {
  const wanted = [...new Map(names.map((n) => [n.trim().toLowerCase(), n.trim()])).entries()].filter(([key]) => key);
  const result = new Map<string, { id: string; name: string }>();
  if (wanted.length === 0) return result;

  const { data, error } = await admin.from("user_groups").select("id, name");
  if (error) throw new Error(`Could not load groups: ${error.message}`);
  for (const row of (data ?? []) as { id: string; name: string }[]) {
    result.set(row.name.trim().toLowerCase(), row);
  }
  const missing = wanted.filter(([key]) => !result.has(key)).map(([, name]) => name.slice(0, 100));
  if (missing.length > 0) {
    const { data: created, error: createError } = await admin
      .from("user_groups")
      .insert(missing.map((name) => ({ name, created_by: callerId })))
      .select("id, name");
    if (createError) throw new Error(`Could not create groups: ${createError.message}`);
    for (const row of (created ?? []) as { id: string; name: string }[]) {
      result.set(row.name.trim().toLowerCase(), row);
    }
  }
  return result;
}

export async function createOneUser(
  admin: SupabaseClient,
  caller: Caller,
  input: NewUser,
  groupIds: Map<string, { id: string; name: string }> = new Map(),
): Promise<CreateOutcome> {
  const callerIsAdmin = caller.role === "admin";
  if (input.role === "admin" && !callerIsAdmin) {
    return { ok: false, status: 403, error: "Only an administrator can create another administrator." };
  }
  if (input.access.length > 0 && !callerIsAdmin) {
    return { ok: false, status: 403, error: "Only an administrator can grant module access." };
  }

  const { data: existing, error: existingError } = await admin
    .from("profiles")
    .select("id")
    .eq("email", input.email)
    .maybeSingle();
  if (existingError) throw new Error(`Could not check existing accounts: ${existingError.message}`);
  if (existing) return { ok: false, status: 409, error: `An account already exists for ${input.email}.` };

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: input.email,
    password: randomPassword(),
    email_confirm: true,
    user_metadata: { full_name: input.fullName },
  });
  if (createError || !created.user) {
    const already = /already|registered|exists/i.test(createError?.message ?? "");
    return {
      ok: false,
      status: already ? 409 : 500,
      error: already ? `A login already exists for ${input.email}.` : "Could not create the login.",
    };
  }
  const userId = created.user.id;

  const { error: profileError } = await admin.from("profiles").insert({
    id: userId,
    full_name: input.fullName,
    email: input.email,
    role: input.role,
    department: input.department || null,
    position: input.position || null,
    manager_id: input.managerId || null,
    // The person sets their own password through the activation code.
    must_change_password: false,
  });
  if (profileError) {
    await admin.auth.admin.deleteUser(userId);
    return { ok: false, status: 500, error: "Could not create the profile." };
  }

  // Admins already have every module; rows only matter for other roles.
  if (input.role !== "admin" && input.access.length > 0) {
    const { error: accessError } = await admin.from("module_access").insert(
      input.access.map((row) => ({ profile_id: userId, module: row.module, level: row.level, updated_by: caller.id })),
    );
    if (accessError) console.error("Could not save module access:", accessError.message);
  }

  const joined: string[] = [];
  const memberships = input.groups
    .map((name) => groupIds.get(name.trim().toLowerCase()))
    .filter((group): group is { id: string; name: string } => Boolean(group));
  if (memberships.length > 0) {
    const unique = [...new Map(memberships.map((g) => [g.id, g])).values()];
    const { error: memberError } = await admin
      .from("user_group_members")
      .insert(unique.map((g) => ({ group_id: g.id, profile_id: userId, added_by: caller.id })));
    if (memberError) console.error("Could not add group memberships:", memberError.message);
    else joined.push(...unique.map((g) => g.name));
  }

  const invited = input.sendInvite ? await sendInvite(input.email) : false;

  await admin.from("audit_log").insert({
    actor_id: caller.id,
    action: "user.created",
    entity: "profiles",
    entity_id: userId,
    details: { email: input.email, role: input.role, access: input.access, groups: joined, invite_sent: invited },
    source: "app",
  });

  return { ok: true, id: userId, inviteSent: invited, groups: joined };
}

async function addMemberships(
  admin: SupabaseClient,
  callerId: string,
  profileId: string,
  names: string[],
  groupIds: Map<string, { id: string; name: string }>,
): Promise<string[]> {
  const groups = [
    ...new Map(
      names
        .map((name) => groupIds.get(name.trim().toLowerCase()))
        .filter((g): g is { id: string; name: string } => Boolean(g))
        .map((g) => [g.id, g]),
    ).values(),
  ];
  if (groups.length === 0) return [];
  const { error } = await admin
    .from("user_group_members")
    .upsert(groups.map((g) => ({ group_id: g.id, profile_id: profileId, added_by: callerId })), {
      onConflict: "group_id,profile_id",
      ignoreDuplicates: true,
    });
  if (error) {
    console.error("Could not add group memberships:", error.message);
    return [];
  }
  return groups.map((g) => g.name);
}

export type UpdateOutcome = { ok: true; id: string; changed: string[] } | { ok: false; status: number; error: string };

/**
 * Bulk upload "update existing people": refreshes name, department and position
 * and adds groups. Never changes role, email, status or module access, which
 * stay in User control where their guardrails live.
 */
export async function updateExistingUser(
  admin: SupabaseClient,
  caller: Caller,
  input: NewUser,
  groupIds: Map<string, { id: string; name: string }>,
): Promise<UpdateOutcome> {
  const { data, error } = await admin
    .from("profiles")
    .select("id, full_name, role, department, position")
    .eq("email", input.email)
    .maybeSingle();
  if (error) throw new Error(`Could not load the account: ${error.message}`);
  const existing = data as { id: string; full_name: string; role: string; department: string | null; position: string | null } | null;
  if (!existing) return { ok: false, status: 404, error: "No account found to update." };
  if (existing.role === "admin" && caller.role !== "admin") {
    return { ok: false, status: 403, error: "Only an administrator can update an administrator." };
  }

  const patch: Record<string, string> = {};
  if (input.fullName && input.fullName !== existing.full_name) patch.full_name = input.fullName;
  if (input.department && input.department !== existing.department) patch.department = input.department;
  if (input.position && input.position !== existing.position) patch.position = input.position;
  const changed = Object.keys(patch).map((key) => key.replace("_", " "));
  if (changed.length > 0) {
    const { error: updateError } = await admin.from("profiles").update(patch).eq("id", existing.id);
    if (updateError) return { ok: false, status: 500, error: "Could not update the account." };
    // Keep a talent's own department and position in step.
    const talentPatch: Record<string, string> = {};
    if (patch.department) talentPatch.department = patch.department;
    if (patch.position) talentPatch.position = patch.position;
    if (Object.keys(talentPatch).length > 0) await admin.from("talents").update(talentPatch).eq("profile_id", existing.id);
  }
  const joined = await addMemberships(admin, caller.id, existing.id, input.groups, groupIds);
  if (joined.length > 0) changed.push(`groups (${joined.join(", ")})`);

  if (changed.length > 0) {
    await admin.from("audit_log").insert({
      actor_id: caller.id,
      action: "user.updated_by_upload",
      entity: "profiles",
      entity_id: existing.id,
      details: { email: input.email, changed: patch, groups: joined },
      source: "app",
    });
  }
  return { ok: true, id: existing.id, changed };
}
