import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const DAY_MS = 24 * 60 * 60 * 1000;

type Admin = SupabaseClient;

type ReminderRow = {
  id: string;
  last_reminded_at: string | null;
  assessor: { email: string } | null;
  cycles: { reminder_every_days: number };
};

type StatusRow = {
  cycle_id: string;
  talent_id: string;
  status: string;
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function secretMatches(provided: string | null, expected: string | undefined): boolean {
  if (!provided || !expected) return false;
  const a = new TextEncoder().encode(provided);
  const b = new TextEncoder().encode(expected);
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}

async function sendEmail(body: Record<string, unknown>): Promise<boolean> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const internalSecret = Deno.env.get("INTERNAL_SECRET");
  if (!supabaseUrl || !internalSecret) {
    console.error(`Email ${String(body.type)} not sent: INTERNAL_SECRET is not configured.`);
    return false;
  }
  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-secret": internalSecret },
      body: JSON.stringify(body),
    });
    if (!response.ok) console.error(`Email ${String(body.type)} responded with status ${response.status}`);
    return response.ok;
  } catch (error) {
    console.error(`Email ${String(body.type)} request failed:`, error instanceof Error ? error.message : error);
    return false;
  }
}

async function adminEmails(admin: Admin): Promise<string[]> {
  const { data, error } = await admin.from("profiles").select("email").eq("role", "admin");
  if (error) throw new Error(`Could not load administrators: ${error.message}`);
  return (data ?? []).map((row) => row.email as string);
}

async function recordSchedulerAudit(admin: Admin, action: string, entityIds: string[]): Promise<void> {
  if (entityIds.length === 0) return;
  const { error } = await admin.from("audit_log").insert(
    entityIds.map((entityId) => ({
      actor_id: null,
      action,
      entity: "cycle",
      entity_id: entityId,
      details: { source: "daily-scheduler" },
    })),
  );
  if (error) console.error(`Could not record ${action}:`, error.message);
}

async function openDueCycles(admin: Admin, nowIso: string): Promise<{ opened: number; blocked: string[] }> {
  const { data: due, error: dueError } = await admin
    .from("cycles")
    .select("id, name")
    .eq("status", "draft")
    .lte("opens_at", nowIso);
  if (dueError) throw new Error(`Could not load due cycles: ${dueError.message}`);

  const opened: string[] = [];
  const blocked: string[] = [];
  for (const cycle of due ?? []) {
    const { error } = await admin.from("cycles").update({ status: "open" }).eq("id", cycle.id).eq("status", "draft");
    if (!error) {
      opened.push(cycle.id as string);
      continue;
    }
    console.error(`Cycle ${cycle.name} not opened:`, error.message);
    blocked.push(`${cycle.name}: ${error.message}`);
  }
  await recordSchedulerAudit(admin, "cycle.opened", opened);
  return { opened: opened.length, blocked };
}

async function sendSubmittedAlertDigests(admin: Admin): Promise<number> {
  const { data, error } = await admin
    .from("notification_digest_queue")
    .select("id, cycle_id, assignment_id, profiles(email)")
    .order("created_at");
  if (error) throw new Error(`Could not load the digest queue: ${error.message}`);

  const rows = (data ?? []) as unknown as {
    id: string;
    cycle_id: string;
    assignment_id: string | null;
    profiles: { email: string };
  }[];

  const grouped = new Map<string, { emails: Set<string>; assignmentId: string | null }>();
  for (const row of rows) {
    const group = grouped.get(row.cycle_id) ?? { emails: new Set<string>(), assignmentId: row.assignment_id };
    group.emails.add(row.profiles.email);
    grouped.set(row.cycle_id, group);
  }

  let delivered = 0;
  const handledIds: string[] = [];
  for (const row of rows) {
    const group = grouped.get(row.cycle_id);
    if (!group || !group.emails.has(row.profiles.email)) continue;
    const talentId = await talentIdForAssignment(admin, row.assignment_id);
    const ok = await sendEmail({
      type: "submitted_alert",
      recipient_email: row.profiles.email,
      assignment_id: row.assignment_id,
      cycle_id: row.cycle_id,
      talent_id: talentId,
      digest: true,
      digest_cycles: grouped.size,
    });
    if (ok) {
      handledIds.push(row.id);
      delivered += 1;
    }
  }

  for (const id of handledIds) {
    const { error: deleteError } = await admin.from("notification_digest_queue").delete().eq("id", id);
    if (deleteError) console.error("Could not remove a digest queue entry:", deleteError.message);
  }
  return delivered;
}

async function talentIdForAssignment(admin: Admin, assignmentId: string | null): Promise<string | null> {
  if (!assignmentId) return null;
  const { data, error } = await admin.from("assignments").select("talent_id").eq("id", assignmentId).maybeSingle();
  if (error) return null;
  return (data as { talent_id: string } | null)?.talent_id ?? null;
}

async function sendDueReminders(admin: Admin, nowMs: number): Promise<number> {
  const { data, error } = await admin
    .from("assignments")
    .select(
      "id, last_reminded_at, assessor:profiles!assessor_id(email), cycles!inner(reminder_every_days, status, closes_at)",
    )
    .eq("cycles.status", "open")
    .gt("cycles.closes_at", new Date(nowMs).toISOString())
    .neq("status", "submitted");
  if (error) throw new Error(`Could not load assessments due a reminder: ${error.message}`);

  let sent = 0;
  for (const row of (data ?? []) as unknown as ReminderRow[]) {
    const email = row.assessor?.email;
    if (!email) continue;
    const intervalMs = row.cycles.reminder_every_days * DAY_MS;
    if (row.last_reminded_at && nowMs - Date.parse(row.last_reminded_at) < intervalMs) continue;

    const delivered = await sendEmail({ type: "reminder", recipient_email: email, assignment_id: row.id });
    if (!delivered) continue;

    const { error: updateError } = await admin
      .from("assignments")
      .update({ last_reminded_at: new Date(nowMs).toISOString() })
      .eq("id", row.id);
    if (updateError) console.error("Could not record reminder time:", updateError.message);
    else sent += 1;
  }
  return sent;
}

async function closeDueCycles(admin: Admin, nowIso: string): Promise<string[]> {
  const { data, error } = await admin
    .from("cycles")
    .update({ status: "closed" })
    .eq("status", "open")
    .lte("closes_at", nowIso)
    .select("id");
  if (error) throw new Error(`Could not close cycles: ${error.message}`);
  const ids = (data ?? []).map((row) => row.id as string);
  await recordSchedulerAudit(admin, "cycle.closed", ids);
  return ids;
}

async function sendCycleClosedSummaries(admin: Admin, cycleIds: string[]): Promise<void> {
  if (cycleIds.length === 0) return;
  const recipients = await adminEmails(admin);
  for (const cycleId of cycleIds) {
    for (const email of recipients) {
      await sendEmail({ type: "cycle_closed", recipient_email: email, cycle_id: cycleId });
    }
  }
}

async function announceCompletedTalents(admin: Admin): Promise<number> {
  const { data, error } = await admin
    .from("assignments")
    .select("cycle_id, talent_id, status, cycles!inner(status)")
    .in("cycles.status", ["open", "closed"]);
  if (error) throw new Error(`Could not check completed talents: ${error.message}`);

  const groups = new Map<string, { cycleId: string; talentId: string; complete: boolean }>();
  for (const row of (data ?? []) as unknown as StatusRow[]) {
    const key = `${row.cycle_id}|${row.talent_id}`;
    const submitted = row.status === "submitted";
    const existing = groups.get(key);
    if (existing) existing.complete = existing.complete && submitted;
    else groups.set(key, { cycleId: row.cycle_id, talentId: row.talent_id, complete: submitted });
  }

  let announced = 0;
  let recipients: string[] | null = null;
  for (const group of groups.values()) {
    if (!group.complete) continue;

    const { data: claimed, error: claimError } = await admin
      .from("dashboard_ready_notices")
      .upsert(
        { cycle_id: group.cycleId, talent_id: group.talentId },
        { onConflict: "cycle_id,talent_id", ignoreDuplicates: true },
      )
      .select("cycle_id");
    if (claimError) {
      console.error("Could not record dashboard notice:", claimError.message);
      continue;
    }
    if (!claimed || claimed.length === 0) continue;

    recipients ??= await adminEmails(admin);
    for (const email of recipients) {
      await sendEmail({
        type: "dashboard_ready",
        recipient_email: email,
        cycle_id: group.cycleId,
        talent_id: group.talentId,
      });
    }
    announced += 1;
  }
  return announced;
}

async function runStep<T>(name: string, work: () => Promise<T>): Promise<T | null> {
  try {
    return await work();
  } catch (error) {
    console.error(`daily-scheduler ${name} failed:`, error instanceof Error ? error.message : error);
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    if (!secretMatches(req.headers.get("x-cron-secret"), Deno.env.get("CRON_SECRET"))) {
      return json({ error: "Unauthorized." }, 401);
    }
    if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();

    const opening = await runStep("opening cycles", () => openDueCycles(admin, nowIso));
    const cyclesOpened = opening?.opened ?? null;
    const cyclesBlocked = opening?.blocked ?? [];
    const digestsSent = await runStep("sending submitted alert digests", () => sendSubmittedAlertDigests(admin));
    const remindersSent = await runStep("sending reminders", () => sendDueReminders(admin, nowMs));
    const closedIds = await runStep("closing cycles", () => closeDueCycles(admin, nowIso));
    if (closedIds) await runStep("sending cycle summaries", () => sendCycleClosedSummaries(admin, closedIds));
    const dashboardsAnnounced = await runStep("announcing completed talents", () => announceCompletedTalents(admin));

    const failedSteps = [
      cyclesOpened === null && "opening cycles",
      digestsSent === null && "sending submitted alert digests",
      remindersSent === null && "sending reminders",
      closedIds === null && "closing cycles",
      dashboardsAnnounced === null && "announcing completed talents",
    ].filter(Boolean);

    return json(
      {
        cycles_opened: cyclesOpened,
        cycles_blocked: cyclesBlocked,
        digests_sent: digestsSent,
        reminders_sent: remindersSent,
        cycles_closed: closedIds?.length ?? null,
        dashboards_announced: dashboardsAnnounced,
        failed_steps: failedSteps,
      },
      failedSteps.length === 0 ? 200 : 500,
    );
  } catch (error) {
    console.error("daily-scheduler failed:", error instanceof Error ? error.message : error);
    return json({ error: "The scheduler could not run." }, 500);
  }
});
