// Editing people's details.
//
// Administrators (action admin_update): name, email, department, position, immediate manager and groups of any
// employee account. An email change switches sign-in to the new address at once and notifies both addresses.
//
// Everyone, for themselves:
// - self_update: name, department and position.
// - self_request_email: emails a 6-digit code to the new address (3 per hour, valid 15 minutes).
// - self_confirm_email: with the right code (5 attempts), switches sign-in to the new address and notifies both.

import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.57.4";
import { AccessError, type Caller, callerFromRequest } from "../_shared/access.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE_TTL_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const MAX_CODES_PER_HOUR = 3;

type Admin = SupabaseClient;
type Body = Record<string, unknown>;
type Target = {
  id: string;
  full_name: string;
  email: string;
  department: string | null;
  position: string | null;
  manager_id: string | null;
  person_type: string;
  deleted_at: string | null;
  deletion_requested_at: string | null;
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function optionalText(body: Body, key: string, max: number, label: string): string | null | undefined {
  if (!(key in body)) return undefined;
  const value = body[key];
  if (value === null) return null;
  if (typeof value !== "string") throw new AccessError(400, `${label} is not valid.`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new AccessError(400, `${label} can be up to ${max} characters.`);
  return trimmed || null;
}

function requiredName(body: Body): string | undefined {
  const value = optionalText(body, "full_name", 200, "Full name");
  if (value === null) throw new AccessError(400, "Enter a full name.");
  return value;
}

function emailOf(body: Body): string | undefined {
  if (!("email" in body)) return undefined;
  const value = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!EMAIL_PATTERN.test(value) || value.length > 254) throw new AccessError(400, "Enter a valid email address.");
  if (/@(no-email|deleted)\.invalid$/.test(value)) throw new AccessError(400, "Enter a real email address.");
  return value;
}

async function loadTarget(admin: Admin, id: string): Promise<Target> {
  const { data, error } = await admin
    .from("profiles")
    .select("id, full_name, email, department, position, manager_id, person_type, deleted_at, deletion_requested_at")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Could not load the person: ${error.message}`);
  const row = data as Target | null;
  if (!row || row.deleted_at || row.person_type !== "employee") throw new AccessError(404, "That person could not be found.");
  if (row.deletion_requested_at) throw new AccessError(409, "This account is scheduled for deletion. Recover it first.");
  return row;
}

async function emailTaken(admin: Admin, email: string, exceptId: string): Promise<boolean> {
  const { data } = await admin.from("profiles").select("id").eq("email", email).neq("id", exceptId).maybeSingle();
  return Boolean(data);
}

async function sendEmail(body: Body): Promise<boolean> {
  const secret = Deno.env.get("INTERNAL_SECRET");
  if (!secret) return false;
  try {
    const response = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-secret": secret },
      body: JSON.stringify(body),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** Switches the sign-in email and the profile email together, then tells both addresses. */
async function changeEmail(admin: Admin, target: Target, newEmail: string, changedBy: "self" | "admin") {
  if (await emailTaken(admin, newEmail, target.id)) throw new AccessError(409, `${newEmail} is already used by another account.`);
  const { error: authError } = await admin.auth.admin.updateUserById(target.id, { email: newEmail, email_confirm: true });
  if (authError) {
    const taken = /already|registered|exists/i.test(authError.message);
    throw new AccessError(taken ? 409 : 500, taken ? `${newEmail} is already used by another login.` : "Could not change the sign-in email.");
  }
  const { error } = await admin.from("profiles").update({ email: newEmail }).eq("id", target.id);
  if (error) {
    await admin.auth.admin.updateUserById(target.id, { email: target.email, email_confirm: true });
    throw new Error(`Could not save the email: ${error.message}`);
  }
  const notice = { type: "email_changed", old_email: target.email, new_email: newEmail, changed_by: changedBy };
  await Promise.all([
    sendEmail({ ...notice, recipient_email: target.email }),
    sendEmail({ ...notice, recipient_email: newEmail }),
  ]);
}

/** Name, department and position live on the profile and are mirrored on the talents row used in reports. */
async function saveBasics(admin: Admin, id: string, patch: { full_name?: string; department?: string | null; position?: string | null }) {
  if (Object.keys(patch).length === 0) return;
  const { error } = await admin.from("profiles").update(patch).eq("id", id);
  if (error) throw new Error(`Could not save the details: ${error.message}`);
  const talentPatch: Record<string, unknown> = {};
  if ("department" in patch) talentPatch.department = patch.department;
  if ("position" in patch) talentPatch.position = patch.position;
  if (Object.keys(talentPatch).length > 0) await admin.from("talents").update(talentPatch).eq("profile_id", id);
}

async function audit(admin: Admin, actorId: string, action: string, entityId: string, details: Body) {
  await admin.from("audit_log").insert({ actor_id: actorId, action, entity: "profiles", entity_id: entityId, details, source: "app" });
}

async function adminUpdate(admin: Admin, caller: Caller, body: Body) {
  if (caller.role !== "admin") throw new AccessError(403, "Only an administrator can edit other people's details.");
  const userId = typeof body.user_id === "string" && UUID_PATTERN.test(body.user_id) ? body.user_id : "";
  if (!userId) throw new AccessError(400, "Choose a person.");
  const target = await loadTarget(admin, userId);

  const fullName = requiredName(body);
  const department = optionalText(body, "department", 100, "Department");
  const position = optionalText(body, "position", 100, "Position");
  const newEmail = emailOf(body);

  const patch: { full_name?: string; department?: string | null; position?: string | null } = {};
  if (fullName !== undefined && fullName !== target.full_name) patch.full_name = fullName;
  if (department !== undefined && department !== target.department) patch.department = department;
  if (position !== undefined && position !== target.position) patch.position = position;

  // Manager: the database refuses reporting loops and external managers.
  let managerChanged = false;
  if ("manager_id" in body) {
    const managerId = typeof body.manager_id === "string" && UUID_PATTERN.test(body.manager_id) ? body.manager_id : null;
    if (managerId === target.id) throw new AccessError(400, "A person cannot be their own manager.");
    if (managerId !== target.manager_id) {
      const { error } = await admin.from("profiles").update({ manager_id: managerId }).eq("id", target.id);
      if (error) {
        throw new AccessError(400, /loop/i.test(error.message) ? "That would create a reporting loop." : error.message);
      }
      managerChanged = true;
    }
  }

  await saveBasics(admin, target.id, patch);

  // Groups: any number; replaces the current set.
  let groupsChanged = false;
  if (Array.isArray(body.group_ids)) {
    const wanted = [...new Set(body.group_ids.filter((g): g is string => typeof g === "string" && UUID_PATTERN.test(g)))];
    const { data: current } = await admin.from("user_group_members").select("group_id").eq("profile_id", target.id);
    const have = new Set(((current ?? []) as { group_id: string }[]).map((r) => r.group_id));
    const toAdd = wanted.filter((g) => !have.has(g));
    const toRemove = [...have].filter((g) => !wanted.includes(g));
    if (toRemove.length > 0) {
      await admin.from("user_group_members").delete().eq("profile_id", target.id).in("group_id", toRemove);
    }
    if (toAdd.length > 0) {
      const { error } = await admin
        .from("user_group_members")
        .insert(toAdd.map((group_id) => ({ group_id, profile_id: target.id, added_by: caller.id })));
      if (error) throw new Error(`Could not save groups: ${error.message}`);
    }
    groupsChanged = toAdd.length + toRemove.length > 0;
  }

  let emailChanged = false;
  if (newEmail !== undefined && newEmail !== target.email) {
    await changeEmail(admin, target, newEmail, "admin");
    emailChanged = true;
  }

  const changed = [...Object.keys(patch), managerChanged && "manager", groupsChanged && "groups", emailChanged && "email"].filter(Boolean);
  if (changed.length > 0) await audit(admin, caller.id, "user.details_updated", target.id, { changed });
  return { changed };
}

async function selfUpdate(admin: Admin, caller: Caller, body: Body) {
  const target = await loadTarget(admin, caller.id);
  const fullName = requiredName(body);
  const department = optionalText(body, "department", 100, "Department");
  const position = optionalText(body, "position", 100, "Position");
  const patch: { full_name?: string; department?: string | null; position?: string | null } = {};
  if (fullName !== undefined && fullName !== target.full_name) patch.full_name = fullName;
  if (department !== undefined && department !== target.department) patch.department = department;
  if (position !== undefined && position !== target.position) patch.position = position;
  await saveBasics(admin, target.id, patch);
  if (Object.keys(patch).length > 0) await audit(admin, caller.id, "profile.updated_own", target.id, { changed: Object.keys(patch) });
  return { changed: Object.keys(patch), profile: { full_name: fullName ?? target.full_name, department, position } };
}

async function hashCode(profileId: string, email: string, code: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${profileId}:${email}:${code}`));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function sixDigits(): string {
  const value = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return value.toString().padStart(6, "0");
}

async function selfRequestEmail(admin: Admin, caller: Caller, body: Body) {
  const target = await loadTarget(admin, caller.id);
  const newEmail = emailOf(body);
  if (!newEmail) throw new AccessError(400, "Enter your new email address.");
  if (newEmail === target.email) throw new AccessError(400, "That is already your email.");
  if (await emailTaken(admin, newEmail, target.id)) throw new AccessError(409, "That email is already used by another account.");

  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await admin
    .from("email_change_codes")
    .select("id", { count: "exact", head: true })
    .eq("profile_id", target.id)
    .gte("created_at", since);
  if ((count ?? 0) >= MAX_CODES_PER_HOUR) throw new AccessError(429, "Too many codes requested. Try again in an hour.");

  const code = sixDigits();
  const { error } = await admin.from("email_change_codes").insert({
    profile_id: target.id,
    new_email: newEmail,
    code_hash: await hashCode(target.id, newEmail, code),
    expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
  });
  if (error) throw new Error(`Could not save the code: ${error.message}`);
  const sent = await sendEmail({ type: "email_change_code", recipient_email: newEmail, activation_code: code });
  if (!sent) throw new AccessError(502, "We could not send the code. Check the address and try again.");
  return { sent_to: newEmail };
}

async function selfConfirmEmail(admin: Admin, caller: Caller, body: Body) {
  const target = await loadTarget(admin, caller.id);
  const code = typeof body.code === "string" ? body.code.replace(/\s/g, "") : "";
  if (!/^\d{6}$/.test(code)) throw new AccessError(400, "Enter the 6-digit code.");

  const { data } = await admin
    .from("email_change_codes")
    .select("id, new_email, code_hash, expires_at, attempts")
    .eq("profile_id", target.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const row = data as { id: string; new_email: string; code_hash: string; expires_at: string; attempts: number } | null;
  if (!row || Date.parse(row.expires_at) <= Date.now() || row.attempts >= MAX_ATTEMPTS) {
    throw new AccessError(400, "This code has expired. Request a new one.");
  }
  if ((await hashCode(target.id, row.new_email, code)) !== row.code_hash) {
    await admin.from("email_change_codes").update({ attempts: row.attempts + 1 }).eq("id", row.id);
    throw new AccessError(400, "That code is not right. Check the email and try again.");
  }

  await changeEmail(admin, target, row.new_email, "self");
  await admin.from("email_change_codes").delete().eq("profile_id", target.id);
  await audit(admin, caller.id, "profile.email_changed_own", target.id, {});
  return { email: row.new_email };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  try {
    if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const caller = await callerFromRequest(admin, req);
    if (!caller.isActive) throw new AccessError(403, "Your account is deactivated.");
    const body = ((await req.json().catch(() => null)) ?? {}) as Body;

    switch (body.action) {
      case "admin_update":
        return json(await adminUpdate(admin, caller, body), 200);
      case "self_update":
        return json(await selfUpdate(admin, caller, body), 200);
      case "self_request_email":
        return json(await selfRequestEmail(admin, caller, body), 200);
      case "self_confirm_email":
        return json(await selfConfirmEmail(admin, caller, body), 200);
      default:
        return json({ error: "Unknown action." }, 400);
    }
  } catch (error) {
    if (error instanceof AccessError) return json({ error: error.message }, error.status);
    console.error("edit-profile failed:", error instanceof Error ? error.message : error);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
});
