// Bulk user creation from an uploaded Excel sheet (Workspace > Users > Bulk upload).
// The browser parses the file, checks it, and sends rows in batches of up to
// MAX_ROWS. Each row is created with the same rules as Add user
// (_shared/userCreation.ts); one bad row never stops the others.

import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { AccessError, callerFromRequest, hasModule } from "../_shared/access.ts";
import {
  EMAIL_PATTERN,
  ROLES,
  createOneUser,
  ensureGroups,
  updateExistingUser,
  type NewUser,
  type Role,
} from "../_shared/userCreation.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const MAX_ROWS = 25;

type RowResult = { row: number; email: string; status: "created" | "updated" | "skipped" | "failed"; message: string };

const shortText = (value: unknown) => (typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, 100) : "");

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function parseRow(
  raw: unknown,
): { row: number; input: NewUser; update: boolean } | { row: number; email: string; error: string } {
  const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const row = typeof r.row === "number" ? r.row : 0;
  const email = typeof r.email === "string" ? r.email.trim().toLowerCase() : "";
  const fullName = typeof r.fullName === "string" ? r.fullName.trim().replace(/\s+/g, " ") : "";
  const role = typeof r.role === "string" ? r.role.trim().toLowerCase() : "";
  if (!fullName || fullName.length > 200) return { row, email, error: "Full name is missing." };
  if (!EMAIL_PATTERN.test(email) || email.length > 254) return { row, email, error: "Email is not valid." };
  if (!(ROLES as readonly string[]).includes(role)) return { row, email, error: "Role must be admin, manager, assessor or talent." };
  const groups = Array.isArray(r.groups)
    ? r.groups.filter((g): g is string => typeof g === "string" && g.trim().length > 0).map((g) => g.trim().slice(0, 100))
    : [];
  return {
    row,
    update: r.update === true,
    input: {
      fullName,
      email,
      role: role as Role,
      access: [],
      groups,
      sendInvite: r.sendInvite !== false,
      department: shortText(r.department) || null,
      position: shortText(r.position) || null,
    },
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
      return json({ error: "You need edit access to Users to upload accounts." }, 403);
    }

    const body = (await req.json().catch(() => null)) as { rows?: unknown } | null;
    if (!body || !Array.isArray(body.rows) || body.rows.length === 0) return json({ error: "No rows were sent." }, 400);
    if (body.rows.length > MAX_ROWS) return json({ error: `Send at most ${MAX_ROWS} rows at a time.` }, 400);

    const parsed = body.rows.map(parseRow);
    const valid = parsed.filter((p): p is { row: number; input: NewUser; update: boolean } => "input" in p);
    const groups = await ensureGroups(admin, caller.id, valid.flatMap((p) => p.input.groups));

    const results: RowResult[] = [];
    for (const item of parsed) {
      if (!("input" in item)) {
        results.push({ row: item.row, email: item.email, status: "failed", message: item.error });
        continue;
      }
      try {
        if (item.update) {
          const updated = await updateExistingUser(admin, caller, item.input, groups);
          results.push(
            updated.ok
              ? {
                  row: item.row,
                  email: item.input.email,
                  status: updated.changed.length > 0 ? "updated" : "skipped",
                  message: updated.changed.length > 0 ? `Updated ${updated.changed.join(", ")}.` : "Already up to date.",
                }
              : { row: item.row, email: item.input.email, status: "failed", message: updated.error },
          );
          continue;
        }
        const outcome = await createOneUser(admin, caller, item.input, groups);
        if (outcome.ok) {
          results.push({
            row: item.row,
            email: item.input.email,
            status: "created",
            message: item.input.sendInvite
              ? outcome.inviteSent ? "Created, invitation sent." : "Created, but the invitation could not be sent."
              : "Created, no invitation sent.",
          });
        } else {
          results.push({
            row: item.row,
            email: item.input.email,
            status: outcome.status === 409 ? "skipped" : "failed",
            message: outcome.error,
          });
        }
      } catch (error) {
        console.error("bulk row failed:", error instanceof Error ? error.message : error);
        results.push({ row: item.row, email: item.input.email, status: "failed", message: "Unexpected error for this row." });
      }
    }

    await admin.from("audit_log").insert({
      actor_id: caller.id,
      action: "user.bulk_upload",
      entity: "profiles",
      entity_id: null,
      details: {
        rows: results.length,
        created: results.filter((r) => r.status === "created").length,
        updated: results.filter((r) => r.status === "updated").length,
        skipped: results.filter((r) => r.status === "skipped").length,
        failed: results.filter((r) => r.status === "failed").length,
      },
      source: "app",
    });

    return json({ results }, 200);
  } catch (error) {
    if (error instanceof AccessError) return json({ error: error.message }, error.status);
    console.error("bulk-create-users failed:", error instanceof Error ? error.message : error);
    return json({ error: "Unexpected error while uploading accounts." }, 500);
  }
});
