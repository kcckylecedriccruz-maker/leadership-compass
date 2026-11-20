// Hourly job (pg_cron, same secret as the daily scheduler).
//
// Accounts an administrator deleted more than 3 days ago and did not recover are anonymised in the database by
// purge_due_deletions(); this function then deletes their logins.

import { createClient } from "npm:@supabase/supabase-js@2.57.4";

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function secretMatches(given: string | null, expected: string | undefined): boolean {
  if (!given || !expected || given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i += 1) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  try {
    if (!secretMatches(req.headers.get("x-cron-secret"), Deno.env.get("CRON_SECRET"))) {
      return json({ error: "Unauthorized." }, 401);
    }
    if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data, error } = await admin.rpc("purge_due_deletions");
    if (error) throw new Error(`Could not purge accounts: ${error.message}`);
    const ids = ((data ?? []) as unknown[]).map((row) => (typeof row === "string" ? row : String((row as Record<string, unknown>).purge_due_deletions)));

    let loginsDeleted = 0;
    const failed: string[] = [];
    for (const id of ids) {
      const { error: deleteError } = await admin.auth.admin.deleteUser(id);
      // A login that is already gone counts as done.
      if (deleteError && !/not found/i.test(deleteError.message)) {
        console.error(`Could not delete login ${id}:`, deleteError.message);
        failed.push(id);
      } else {
        loginsDeleted += 1;
      }
    }
    return json({ anonymised: ids.length, logins_deleted: loginsDeleted, failed }, failed.length === 0 ? 200 : 500);
  } catch (error) {
    console.error("purge-deleted-accounts failed:", error instanceof Error ? error.message : error);
    return json({ error: "The purge could not run." }, 500);
  }
});
