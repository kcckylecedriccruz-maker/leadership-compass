// People who evaluate without an account.
//
// Actions:
// - quick_add_employee: add an employee (name, email, manager) without sending an account invitation. They are
//   rated and rate others by secure link until they activate. Users or Org structure edit, or a manager adding
//   their own direct report.
// - add_external / remove_external: external raters (clients, partners, contractors) for an employee. They never
//   get a login. Org structure edit, or the employee's immediate manager.
// - send_link / revoke_link: email a fresh secure link for one cycle (older links stop working), or switch it off.
//   Cycles or Assignments edit.

import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.57.4";
import { AccessError, type Caller, callerFromRequest, hasModule } from "../_shared/access.ts";
import { revokeLink, rotateLink, usesLink } from "../_shared/evaluationLinks.ts";
import { ExternalRaterError, findOrCreateExternal, linkExternalToEmployee } from "../_shared/externalRaters.ts";
import { createOneUser, EMAIL_PATTERN } from "../_shared/userCreation.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

type Admin = SupabaseClient;
type Body = Record<string, unknown>;

function text(body: Body, key: string, max: number, required = false): string {
  const value = typeof body[key] === "string" ? (body[key] as string).trim() : "";
  if (required && !value) throw new AccessError(400, `${key.replace("_", " ")} is required.`);
  if (value.length > max) throw new AccessError(400, `${key.replace("_", " ")} can be up to ${max} characters.`);
  return value;
}

function id(body: Body, key: string): string {
  const value = body[key];
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) throw new AccessError(400, "Choose a person.");
  return value;
}

function email(body: Body): string {
  const value = text(body, "email", 254, true).toLowerCase();
  if (!EMAIL_PATTERN.test(value)) throw new AccessError(400, "Enter a valid email address.");
  return value;
}

async function isManagerOf(admin: Admin, managerId: string, employeeId: string): Promise<boolean> {
  const { data } = await admin.from("profiles").select("manager_id").eq("id", employeeId).maybeSingle();
  return (data as { manager_id: string | null } | null)?.manager_id === managerId;
}

async function canEditOrg(admin: Admin, caller: Caller): Promise<boolean> {
  return (await hasModule(admin, caller, "talents", "edit")) || (await hasModule(admin, caller, "users", "edit"));
}

async function audit(admin: Admin, caller: Caller, action: string, entity: string, entityId: string, details: Body) {
  await admin.from("audit_log").insert({ actor_id: caller.id, action, entity, entity_id: entityId, details, source: "app" });
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

async function quickAddEmployee(admin: Admin, caller: Caller, body: Body) {
  const managerId = typeof body.manager_id === "string" && UUID_PATTERN.test(body.manager_id) ? body.manager_id : null;
  if (!(await canEditOrg(admin, caller)) && managerId !== caller.id) {
    throw new AccessError(403, "You can quick-add people who report to you. Ask an administrator for anyone else.");
  }
  if (managerId) {
    const { data: manager } = await admin.from("profiles").select("person_type, is_active").eq("id", managerId).maybeSingle();
    const row = manager as { person_type: string; is_active: boolean } | null;
    if (!row || !row.is_active || row.person_type !== "employee") throw new AccessError(400, "Choose an active employee as manager.");
  }
  const outcome = await createOneUser(admin, caller, {
    fullName: text(body, "full_name", 200, true),
    email: email(body),
    role: "employee",
    access: [],
    groups: [],
    sendInvite: false,
    department: text(body, "department", 100) || null,
    position: text(body, "position", 100) || null,
    managerId,
  });
  if (!outcome.ok) throw new AccessError(outcome.status, outcome.error);
  await audit(admin, caller, "person.quick_added", "profiles", outcome.id, { manager_id: managerId });
  return { id: outcome.id };
}

async function requireEmployee(admin: Admin, employeeId: string) {
  const { data } = await admin.from("profiles").select("id, person_type, is_active").eq("id", employeeId).maybeSingle();
  const row = data as { id: string; person_type: string; is_active: boolean } | null;
  if (!row || row.person_type !== "employee" || !row.is_active) throw new AccessError(404, "That employee could not be found.");
}

async function addExternal(admin: Admin, caller: Caller, body: Body) {
  const employeeId = id(body, "employee_id");
  if (!(await canEditOrg(admin, caller)) && !(await isManagerOf(admin, caller.id, employeeId))) {
    throw new AccessError(403, "Only administrators and the immediate manager can add external raters.");
  }
  await requireEmployee(admin, employeeId);
  const address = email(body);
  const fullName = text(body, "full_name", 200, true);
  const organisation = text(body, "organisation", 100) || null;

  const rater = await findOrCreateExternal(admin, { email: address, fullName, organisation });
  const raterId = rater.id;
  await linkExternalToEmployee(admin, employeeId, raterId, caller.id);
  const { data: added, error: applyError } = await admin.rpc("apply_external_rater", { p_employee: employeeId, p_rater: raterId });
  if (applyError) throw new Error(`Could not add them to open cycles: ${applyError.message}`);
  return { id: raterId, added_to_open_cycles: added ?? 0 };
}

async function removeExternal(admin: Admin, caller: Caller, body: Body) {
  const employeeId = id(body, "employee_id");
  const raterId = id(body, "rater_id");
  if (!(await canEditOrg(admin, caller)) && !(await isManagerOf(admin, caller.id, employeeId))) {
    throw new AccessError(403, "Only administrators and the immediate manager can remove external raters.");
  }
  const { error } = await admin.from("external_raters").delete().eq("employee_id", employeeId).eq("rater_id", raterId);
  if (error) throw new Error(`Could not remove the external rater: ${error.message}`);
  const { data: removed, error: withdrawError } = await admin.rpc("withdraw_external_rater", { p_employee: employeeId, p_rater: raterId });
  if (withdrawError) throw new Error(`Could not update open cycles: ${withdrawError.message}`);
  return { removed_from_cycles: removed ?? 0 };
}

async function requireLinkAccess(admin: Admin, caller: Caller) {
  if (!(await hasModule(admin, caller, "cycles", "edit")) && !(await hasModule(admin, caller, "assignments", "edit"))) {
    throw new AccessError(403, "You need edit access to Cycles or Assignments to manage feedback links.");
  }
}

async function linkTarget(admin: Admin, body: Body) {
  const profileId = id(body, "profile_id");
  const cycleId = id(body, "cycle_id");
  const { data } = await admin
    .from("profiles")
    .select("id, email, activated_at, person_type, is_active")
    .eq("id", profileId)
    .maybeSingle();
  const person = data as { id: string; email: string; activated_at: string | null; person_type: string; is_active: boolean } | null;
  if (!person || !person.is_active) throw new AccessError(404, "That person could not be found.");
  return { person, cycleId };
}

async function sendLink(admin: Admin, caller: Caller, body: Body) {
  await requireLinkAccess(admin, caller);
  const { person, cycleId } = await linkTarget(admin, body);
  if (!usesLink(person)) throw new AccessError(409, "This person has an account and signs in, so they do not need a link.");
  const { data: cycle } = await admin.from("cycles").select("status").eq("id", cycleId).maybeSingle();
  if ((cycle as { status: string } | null)?.status !== "open") throw new AccessError(409, "Open the cycle before sending links.");
  await rotateLink(admin, person.id, cycleId);
  const sent = await sendEmail({ type: "evaluation_link", recipient_email: person.email, cycle_id: cycleId });
  await audit(admin, caller, "link.sent", "profiles", person.id, { cycle_id: cycleId, emailed: sent });
  if (!sent) throw new AccessError(502, "The link was replaced, but the email could not be sent. Check the email settings.");
  return { sent: true };
}

async function revoke(admin: Admin, caller: Caller, body: Body) {
  await requireLinkAccess(admin, caller);
  const { person, cycleId } = await linkTarget(admin, body);
  const revoked = await revokeLink(admin, person.id, cycleId);
  await audit(admin, caller, "link.revoked", "profiles", person.id, { cycle_id: cycleId });
  return { revoked };
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
      case "quick_add_employee":
        return json(await quickAddEmployee(admin, caller, body), 200);
      case "add_external":
        return json(await addExternal(admin, caller, body), 200);
      case "remove_external":
        return json(await removeExternal(admin, caller, body), 200);
      case "send_link":
        return json(await sendLink(admin, caller, body), 200);
      case "revoke_link":
        return json(await revoke(admin, caller, body), 200);
      default:
        return json({ error: "Unknown action." }, 400);
    }
  } catch (error) {
    if (error instanceof AccessError || error instanceof ExternalRaterError) return json({ error: error.message }, error.status);
    console.error("manage-people failed:", error instanceof Error ? error.message : error);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
});
