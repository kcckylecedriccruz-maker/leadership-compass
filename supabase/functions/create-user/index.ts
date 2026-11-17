// User creation from Workspace > Users > Add user.
// The rules live in _shared/userCreation.ts and are shared with bulk upload.

import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { AccessError, MODULES, callerFromRequest, hasModule, type Module } from "../_shared/access.ts";
import { EMAIL_PATTERN, ROLES, createOneUser, ensureGroups, type NewUser, type Role } from "../_shared/userCreation.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function parse(body: unknown): NewUser | string {
  if (typeof body !== "object" || body === null) return "The request is not valid.";
  const b = body as Record<string, unknown>;
  const fullName = typeof b.fullName === "string" ? b.fullName.trim().replace(/\s+/g, " ") : "";
  const email = typeof b.email === "string" ? b.email.trim().toLowerCase() : "";
  if (!fullName || fullName.length > 200) return "Enter the person's full name.";
  if (!EMAIL_PATTERN.test(email) || email.length > 254) return "Enter a valid work email address.";
  if (typeof b.role !== "string" || !(ROLES as readonly string[]).includes(b.role)) return "Choose a role.";
  const access: NewUser["access"] = [];
  if (Array.isArray(b.access)) {
    for (const item of b.access) {
      const row = item as Record<string, unknown>;
      if (!(MODULES as readonly string[]).includes(String(row?.module))) return "One of the modules is not valid.";
      if (row.module === "settings") return "Settings is for administrators only.";
      if (row.level !== "view" && row.level !== "edit") return "Module access must be view or edit.";
      access.push({ module: row.module as Module, level: row.level });
    }
  }
  const groups = Array.isArray(b.groups)
    ? b.groups.filter((g): g is string => typeof g === "string" && g.trim().length > 0).map((g) => g.trim().slice(0, 100))
    : [];
  const short = (value: unknown) => (typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, 100) : "");
  return {
    fullName,
    email,
    role: b.role as Role,
    access,
    groups,
    sendInvite: b.sendInvite !== false,
    department: short(b.department) || null,
    position: short(b.position) || null,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const caller = await callerFromRequest(admin, req);
    if (!(await hasModule(admin, caller, "users", "edit"))) {
      return json({ error: "You need edit access to Users to create accounts." }, 403);
    }

    const input = parse(await req.json().catch(() => null));
    if (typeof input === "string") return json({ error: input }, 400);

    const groups = await ensureGroups(admin, caller.id, input.groups);
    const outcome = await createOneUser(admin, caller, input, groups);
    if (!outcome.ok) return json({ error: outcome.error }, outcome.status);
    return json({ status: "created", id: outcome.id, inviteSent: outcome.inviteSent }, 200);
  } catch (error) {
    if (error instanceof AccessError) return json({ error: error.message }, error.status);
    console.error("create-user failed:", error instanceof Error ? error.message : error);
    return json({ error: "Unexpected error while creating the account." }, 500);
  }
});
