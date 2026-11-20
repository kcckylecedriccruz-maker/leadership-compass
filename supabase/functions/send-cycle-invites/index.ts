// "Send invitations now" for an open cycle.
//
// Emails every assessor whose evaluation in this cycle has not been notified
// yet (not submitted, no reminder sent), then marks it as reminded so the daily
// scheduler continues from there. Sends at most BATCH per call and reports how
// many are left, so the screen can call again until everyone is done.

import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { AccessError, callerFromRequest, hasModule } from "../_shared/access.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BATCH = 60;

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

type Row = { id: string; talent_id: string; assessor: { email: string } | null };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const caller = await callerFromRequest(admin, req);
    if (!(await hasModule(admin, caller, "cycles", "edit"))) {
      return json({ error: "You need edit access to Cycles to send invitations." }, 403);
    }

    const body = (await req.json().catch(() => null)) as { cycle_id?: unknown } | null;
    const cycleId = typeof body?.cycle_id === "string" ? body.cycle_id : "";
    if (!UUID_PATTERN.test(cycleId)) return json({ error: "Choose a cycle." }, 400);

    const { data: cycle } = await admin.from("cycles").select("status").eq("id", cycleId).maybeSingle();
    if ((cycle as { status: string } | null)?.status !== "open") {
      return json({ error: "Open the cycle before sending invitations." }, 409);
    }

    const internalSecret = Deno.env.get("INTERNAL_SECRET");
    if (!internalSecret) return json({ error: "Email is not configured (INTERNAL_SECRET is missing)." }, 500);

    const { data, error } = await admin
      .from("assignments")
      .select("id, talent_id, assessor:profiles!assessor_id(email)")
      .eq("cycle_id", cycleId)
      .neq("status", "submitted")
      .is("last_reminded_at", null)
      .limit(BATCH);
    if (error) throw new Error(`Could not load evaluations: ${error.message}`);
    const rows = (data ?? []) as unknown as Row[];

    let sent = 0;
    let failed = 0;
    for (const row of rows) {
      const email = row.assessor?.email;
      if (!email) continue;
      const response = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-internal-secret": internalSecret },
        body: JSON.stringify({ type: "invite", recipient_email: email, assignment_id: row.id, cycle_id: cycleId, talent_id: row.talent_id }),
      }).catch(() => null);
      if (response?.ok) sent += 1;
      else failed += 1;
      // Marked either way so a failing address is not retried in a loop; the daily reminders carry on.
      await admin.from("assignments").update({ last_reminded_at: new Date().toISOString() }).eq("id", row.id);
    }

    const { count: remaining } = await admin
      .from("assignments")
      .select("id", { count: "exact", head: true })
      .eq("cycle_id", cycleId)
      .neq("status", "submitted")
      .is("last_reminded_at", null);

    await admin.from("audit_log").insert({
      actor_id: caller.id,
      action: "cycle.invitations_sent",
      entity: "cycles",
      entity_id: cycleId,
      details: { sent, failed, remaining: remaining ?? 0 },
      source: "app",
    });
    return json({ sent, failed, remaining: remaining ?? 0 }, 200);
  } catch (error) {
    if (error instanceof AccessError) return json({ error: error.message }, error.status);
    console.error("send-cycle-invites failed:", error instanceof Error ? error.message : error);
    return json({ error: "Unexpected error while sending invitations." }, 500);
  }
});
