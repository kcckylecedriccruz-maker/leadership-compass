// Module access for edge functions. Mirrors private.module_level in the
// database (migration 20261117140000): active admins have edit everywhere,
// other people have what an admin granted in module_access, deactivated
// people have nothing.

import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.57.4";

export const MODULES = ["dashboard", "cycles", "people", "talents", "assignments", "users", "audit", "settings"] as const;
export type Module = (typeof MODULES)[number];
export const LEVEL = { none: 0, view: 1, edit: 2 } as const;

export type Caller = { id: string; email: string; role: string; isActive: boolean };

export class AccessError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function callerFromRequest(admin: SupabaseClient, req: Request): Promise<Caller> {
  const header = req.headers.get("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) throw new AccessError(401, "Please sign in again.");
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) throw new AccessError(401, "Please sign in again.");

  const { data, error } = await admin
    .from("profiles")
    .select("id, email, role, is_active")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (error) throw new Error(`Could not load caller profile: ${error.message}`);
  if (!data) throw new AccessError(403, "Your account is not set up yet.");
  const row = data as { id: string; email: string; role: string; is_active: boolean | null };
  return { id: row.id, email: row.email, role: row.role, isActive: row.is_active !== false };
}

export async function moduleLevel(admin: SupabaseClient, profileId: string, module: Module): Promise<number> {
  const { data, error } = await admin.rpc("module_level_for", { p_profile_id: profileId, p_module: module });
  if (error) throw new Error(`Could not check access: ${error.message}`);
  return typeof data === "number" ? data : 0;
}

export async function hasModule(admin: SupabaseClient, caller: Caller, module: Module, level: "view" | "edit"): Promise<boolean> {
  if (!caller.isActive) return false;
  if (caller.role === "admin") return true;
  return (await moduleLevel(admin, caller.id, module)) >= LEVEL[level];
}

/** Throws a 403 unless the signed-in caller has at least `level` on `module`. */
export async function requireModule(
  admin: SupabaseClient,
  req: Request,
  module: Module,
  level: "view" | "edit",
  message: string,
): Promise<Caller> {
  const caller = await callerFromRequest(admin, req);
  if (!(await hasModule(admin, caller, module, level))) throw new AccessError(403, message);
  return caller;
}

/** For functions that only hold the caller's user id: checks module access with a service-role client. */
export async function hasModuleById(userId: string, module: Module, level: "view" | "edit"): Promise<boolean> {
  const service = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return (await moduleLevel(service, userId, module)) >= LEVEL[level];
}
