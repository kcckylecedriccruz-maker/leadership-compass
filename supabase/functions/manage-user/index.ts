// User control: administrators change roles, deactivate and reactivate
// accounts, require a password change and correct names. Every change is
// written to the audit log, and deactivation also blocks sign-in in Supabase
// Auth so an existing session cannot be refreshed.

import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { AccessError, MODULES, callerFromRequest, hasModule, type Module } from "../_shared/access.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const ROLES = ["admin", "employee"] as const;
type Role = (typeof ROLES)[number];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// About 100 years: Supabase Auth has no "forever" ban.
const BAN_DURATION = "876000h";

type Request =
  | { action: "set_role"; userId: string; role: Role }
  | { action: "deactivate"; userId: string; reason: string | null }
  | { action: "reactivate"; userId: string }
  | { action: "require_password_change"; userId: string }
  | { action: "rename"; userId: string; fullName: string }
  | { action: "set_module_access"; userId: string; access: { module: Module; level: "view" | "edit" }[] };

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function parse(body: unknown): Request | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  if (typeof b.userId !== "string" || !UUID_PATTERN.test(b.userId)) return null;
  switch (b.action) {
    case "set_role":
      return typeof b.role === "string" && (ROLES as readonly string[]).includes(b.role)
        ? { action: "set_role", userId: b.userId, role: b.role as Role }
        : null;
    case "deactivate": {
      const reason = typeof b.reason === "string" ? b.reason.trim().slice(0, 500) : "";
      return { action: "deactivate", userId: b.userId, reason: reason || null };
    }
    case "reactivate":
      return { action: "reactivate", userId: b.userId };
    case "require_password_change":
      return { action: "require_password_change", userId: b.userId };
    case "rename": {
      const fullName = typeof b.fullName === "string" ? b.fullName.trim() : "";
      return fullName.length > 0 && fullName.length <= 200 ? { action: "rename", userId: b.userId, fullName } : null;
    }
    case "set_module_access": {
      if (!Array.isArray(b.access)) return null;
      const access: { module: Module; level: "view" | "edit" }[] = [];
      for (const item of b.access) {
        const row = item as Record<string, unknown>;
        if (!(MODULES as readonly string[]).includes(String(row?.module))) return null;
        if (row.module === "settings") return null; // admin-only, never granted
        if (row.level !== "view" && row.level !== "edit") return null;
        access.push({ module: row.module as Module, level: row.level });
      }
      return { action: "set_module_access", userId: b.userId, access };
    }
    default:
      return null;
  }
}

type ProfileRow = { id: string; full_name: string; email: string; role: Role; is_active: boolean };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    let actor;
    try {
      actor = await callerFromRequest(admin, req);
    } catch (error) {
      if (error instanceof AccessError) return json({ error: error.message }, error.status);
      throw error;
    }
    if (!(await hasModule(admin, actor, "users", "edit"))) {
      return json({ error: "You need edit access to Users to manage accounts." }, 403);
    }
    const actorIsAdmin = actor.role === "admin";

    const request = parse(await req.json().catch(() => null));
    if (!request) return json({ error: "The request is not valid." }, 400);

    const { data: targetData, error: targetError } = await admin
      .from("profiles")
      .select("id, full_name, email, role, is_active")
      .eq("id", request.userId)
      .maybeSingle();
    if (targetError) return json({ error: "Could not load that user." }, 500);
    const target = targetData as ProfileRow | null;
    if (!target) return json({ error: "That user does not exist." }, 404);

    const isSelf = target.id === actor.id;
    const removesAdmin =
      target.role === "admin" &&
      target.is_active &&
      (request.action === "deactivate" || (request.action === "set_role" && request.role !== "admin"));

    if (isSelf && (request.action === "deactivate" || request.action === "set_role" || request.action === "set_module_access")) {
      return json({ error: "You cannot change your own role, access or status. Ask another administrator." }, 400);
    }
    // People with Users edit access who are not admins manage non-admin accounts only.
    if (!actorIsAdmin) {
      if (target.role === "admin") return json({ error: "Only an administrator can change an administrator's account." }, 403);
      if (request.action === "set_role" && request.role === "admin") {
        return json({ error: "Only an administrator can make someone an administrator." }, 403);
      }
      if (request.action === "set_module_access") {
        return json({ error: "Only an administrator can change module access." }, 403);
      }
    }
    if (removesAdmin) {
      const { count } = await admin
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("role", "admin")
        .eq("is_active", true);
      if ((count ?? 0) <= 1) return json({ error: "At least one active administrator must remain." }, 400);
    }

    let auditAction: string;
    let details: Record<string, unknown>;

    switch (request.action) {
      case "set_role": {
        if (target.role === request.role) return json({ status: "unchanged" }, 200);
        const { error } = await admin.from("profiles").update({ role: request.role }).eq("id", target.id);
        if (error) return json({ error: "Could not change the role." }, 500);
        auditAction = "user.role_changed";
        details = { before: { role: target.role }, after: { role: request.role } };
        break;
      }
      case "deactivate": {
        if (!target.is_active) return json({ status: "unchanged" }, 200);
        const { error: banError } = await admin.auth.admin.updateUserById(target.id, { ban_duration: BAN_DURATION });
        if (banError) return json({ error: "Could not block sign-in for this user." }, 500);
        const { error } = await admin
          .from("profiles")
          .update({ is_active: false, deactivated_at: new Date().toISOString(), deactivated_by: actor.id })
          .eq("id", target.id);
        if (error) {
          await admin.auth.admin.updateUserById(target.id, { ban_duration: "none" });
          return json({ error: "Could not deactivate the user." }, 500);
        }
        auditAction = "user.deactivated";
        details = { reason: request.reason, email: target.email };
        break;
      }
      case "reactivate": {
        if (target.is_active) return json({ status: "unchanged" }, 200);
        const { error: unbanError } = await admin.auth.admin.updateUserById(target.id, { ban_duration: "none" });
        if (unbanError) return json({ error: "Could not unblock sign-in for this user." }, 500);
        const { error } = await admin
          .from("profiles")
          .update({ is_active: true, deactivated_at: null, deactivated_by: null })
          .eq("id", target.id);
        if (error) return json({ error: "Could not reactivate the user." }, 500);
        auditAction = "user.reactivated";
        details = { email: target.email };
        break;
      }
      case "require_password_change": {
        const { error } = await admin
          .from("profiles")
          .update({ must_change_password: true, temp_password_expires_at: null })
          .eq("id", target.id);
        if (error) return json({ error: "Could not require a password change." }, 500);
        auditAction = "user.password_change_required";
        details = { email: target.email };
        break;
      }
      case "rename": {
        if (target.full_name === request.fullName) return json({ status: "unchanged" }, 200);
        const { error } = await admin.from("profiles").update({ full_name: request.fullName }).eq("id", target.id);
        if (error) return json({ error: "Could not rename the user." }, 500);
        auditAction = "user.renamed";
        details = { before: { full_name: target.full_name }, after: { full_name: request.fullName } };
        break;
      }
      case "set_module_access": {
        if (target.role === "admin") {
          return json({ error: "Administrators always have full access, so there is nothing to change." }, 400);
        }
        const { data: beforeRows } = await admin
          .from("module_access")
          .select("module, level")
          .eq("profile_id", target.id);
        // Replace the whole set: anything not listed means no access.
        const { error: clearError } = await admin.from("module_access").delete().eq("profile_id", target.id);
        if (clearError) return json({ error: "Could not update module access." }, 500);
        if (request.access.length > 0) {
          const { error: insertError } = await admin.from("module_access").insert(
            request.access.map((row) => ({ profile_id: target.id, module: row.module, level: row.level, updated_by: actor.id })),
          );
          if (insertError) return json({ error: "Could not update module access." }, 500);
        }
        auditAction = "user.module_access_changed";
        details = { before: beforeRows ?? [], after: request.access };
        break;
      }
    }

    const { error: auditError } = await admin.from("audit_log").insert({
      actor_id: actor.id,
      action: auditAction,
      entity: "profiles",
      entity_id: target.id,
      details,
      source: "app",
    });
    if (auditError) console.error("manage-user could not write the audit log:", auditError.message);

    return json({ status: "updated" }, 200);
  } catch (error) {
    console.error("manage-user failed:", error instanceof Error ? error.message : error);
    return json({ error: "Unexpected error while updating the user." }, 500);
  }
});
