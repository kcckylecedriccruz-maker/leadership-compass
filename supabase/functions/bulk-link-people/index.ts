// Bulk upload, phase 2: reporting lines and 360 assessors.
//
// Runs after bulk-create-users has created (or found) every account, so a row
// can point at people anywhere in the same file. For each row:
// - Immediate manager: makes the person a talent (same steps as Add talent:
//   self assessments, manager assessments and notices), or adds the manager to
//   an existing talent. The database creates the Immediate manager assessments.
// - Direct reports and Peers: added as assessors of this talent in every draft
//   or open cycle. Invitations go out now for open cycles; draft cycles are
//   covered by reminders once they open.

import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.57.4";
import { AccessError, callerFromRequest, hasModule } from "../_shared/access.ts";
import { addSelfAssessments, insertTalent, notifyManagerAssignments, sendTalentAddedEmail } from "../_shared/talent-setup.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const MAX_ROWS = 25;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type LinkRow = {
  row: number;
  email: string;
  managerEmail: string | null;
  directReports: string[];
  peers: string[];
  department: string | null;
  position: string | null;
};

type RowResult = { row: number; email: string; status: "linked" | "skipped" | "failed"; message: string };

type Person = { id: string; email: string; activated_at: string | null };

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

const emailList = (value: unknown): string[] =>
  Array.isArray(value)
    ? [...new Set(value.filter((v): v is string => typeof v === "string").map((v) => v.trim().toLowerCase()))].filter((v) =>
        EMAIL_PATTERN.test(v)
      ).slice(0, 50)
    : [];

const shortText = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim().replace(/\s+/g, " ").slice(0, 100) : null;

function parseRow(raw: unknown): LinkRow | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const email = typeof r.email === "string" ? r.email.trim().toLowerCase() : "";
  if (!EMAIL_PATTERN.test(email)) return null;
  const manager = typeof r.managerEmail === "string" ? r.managerEmail.trim().toLowerCase() : "";
  return {
    row: typeof r.row === "number" ? r.row : 0,
    email,
    managerEmail: EMAIL_PATTERN.test(manager) ? manager : null,
    directReports: emailList(r.directReports),
    peers: emailList(r.peers),
    department: shortText(r.department),
    position: shortText(r.position),
  };
}

async function sendAssignmentInvite(assignmentId: string, cycleId: string, talentId: string, email: string): Promise<void> {
  const internalSecret = Deno.env.get("INTERNAL_SECRET");
  if (!internalSecret) return;
  await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-internal-secret": internalSecret },
    body: JSON.stringify({ type: "invite", recipient_email: email, assignment_id: assignmentId, cycle_id: cycleId, talent_id: talentId }),
  }).catch(() => undefined);
}

async function linkRow(
  admin: SupabaseClient,
  callerId: string,
  row: LinkRow,
  people: Map<string, Person>,
  cycles: { id: string; status: string }[],
): Promise<RowResult> {
  const fail = (message: string): RowResult => ({ row: row.row, email: row.email, status: "failed", message });
  const person = people.get(row.email);
  if (!person) return fail("This person's account was not found.");

  const manager = row.managerEmail ? people.get(row.managerEmail) : undefined;
  if (row.managerEmail && !manager) return fail(`Immediate manager ${row.managerEmail} has no account.`);
  if (manager && manager.id === person.id) return fail("A person cannot be their own immediate manager.");

  const assessorRows: { person: Person; classification: "direct_report" | "peer" }[] = [];
  for (const [list, classification] of [[row.directReports, "direct_report"], [row.peers, "peer"]] as const) {
    for (const email of list) {
      const assessor = people.get(email);
      if (!assessor) return fail(`${email} has no account.`);
      if (assessor.id === person.id) return fail("A person cannot assess themselves as a direct report or peer.");
      if (manager && assessor.id === manager.id) return fail(`${email} is already the immediate manager.`);
      assessorRows.push({ person: assessor, classification });
    }
  }

  const notes: string[] = [];
  const { data: talentRow, error: talentError } = await admin
    .from("talents")
    .select("id")
    .eq("profile_id", person.id)
    .maybeSingle();
  if (talentError) throw new Error(`Could not load the talent: ${talentError.message}`);
  let talentId = (talentRow as { id: string } | null)?.id ?? null;

  if (!talentId) {
    if (!manager) {
      return assessorRows.length > 0
        ? fail("Add an Immediate manager: someone being assessed needs one.")
        : { row: row.row, email: row.email, status: "skipped", message: "No reporting line to add." };
    }
    talentId = await insertTalent(admin, callerId, {
      profileId: person.id,
      managers: { managerIds: [manager.id], primaryManagerId: manager.id },
      department: row.department,
      position: row.position,
      existingPerson: true,
    });
    const selfCycles = await addSelfAssessments(admin, callerId, talentId, person.id);
    await notifyManagerAssignments(admin, talentId);
    await sendTalentAddedEmail(person.email);
    notes.push(`made a talent reporting to ${manager.email}`);
    if (selfCycles.length > 0) notes.push(`self assessment in ${selfCycles.length} cycle${selfCycles.length === 1 ? "" : "s"}`);
  } else {
    if (row.department || row.position) {
      const patch: Record<string, string> = {};
      if (row.department) patch.department = row.department;
      if (row.position) patch.position = row.position;
      await admin.from("talents").update(patch).eq("id", talentId);
    }
    if (manager) {
      const { data: managers } = await admin.from("talent_managers").select("manager_profile_id").eq("talent_id", talentId);
      const current = ((managers ?? []) as { manager_profile_id: string }[]).map((m) => m.manager_profile_id);
      if (!current.includes(manager.id)) {
        const { error: managerError } = await admin
          .from("talent_managers")
          .insert({ talent_id: talentId, manager_profile_id: manager.id, is_primary: current.length === 0 });
        if (managerError) return fail(`Could not add the immediate manager: ${managerError.message}`);
        await notifyManagerAssignments(admin, talentId);
        await admin.from("audit_log").insert({
          actor_id: callerId,
          action: "talent.manager_added",
          entity: "talent",
          entity_id: talentId,
          details: { manager_profile_id: manager.id, source: "bulk_upload" },
        });
        notes.push(`immediate manager ${manager.email} added`);
      }
    }
  }

  let added = 0;
  let alreadyThere = 0;
  for (const cycle of cycles) {
    for (const item of assessorRows) {
      const { data: assignment, error } = await admin
        .from("assignments")
        .insert({ cycle_id: cycle.id, talent_id: talentId, assessor_id: item.person.id, classification: item.classification })
        .select("id")
        .single();
      if (error) {
        if (error.code === "23505") {
          alreadyThere += 1;
          continue;
        }
        return fail(`Could not add ${item.person.email} as an assessor: ${error.message}`);
      }
      added += 1;
      await admin.from("audit_log").insert({
        actor_id: callerId,
        action: "assignment.added",
        entity: "assignment",
        entity_id: (assignment as { id: string }).id,
        details: { cycle_id: cycle.id, talent_id: talentId, assessor_id: item.person.id, classification: item.classification, source: "bulk_upload" },
      });
      // Activated assessors get the feedback invitation now for open cycles; new
      // accounts already received their account invitation in phase 1.
      if (cycle.status === "open" && item.person.activated_at) {
        await sendAssignmentInvite((assignment as { id: string }).id, cycle.id, talentId, item.person.email);
      }
    }
  }

  const dr = row.directReports.length;
  const peers = row.peers.length;
  if (dr + peers > 0) {
    if (cycles.length === 0) notes.push(`${dr + peers} assessor${dr + peers === 1 ? "" : "s"} saved for when a cycle exists`);
    else if (added > 0) {
      notes.push(
        `${dr} direct report${dr === 1 ? "" : "s"} and ${peers} peer${peers === 1 ? "" : "s"} assigned in ${cycles.length} cycle${cycles.length === 1 ? "" : "s"}`,
      );
    }
    if (alreadyThere > 0) notes.push(`${alreadyThere} assignment${alreadyThere === 1 ? " was" : "s were"} already in place`);
  }

  if (notes.length === 0) return { row: row.row, email: row.email, status: "skipped", message: "Reporting lines already in place." };
  const message = notes.join("; ");
  return { row: row.row, email: row.email, status: "linked", message: message.charAt(0).toUpperCase() + message.slice(1) + "." };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const caller = await callerFromRequest(admin, req);
    const canLink =
      (await hasModule(admin, caller, "users", "edit")) &&
      (await hasModule(admin, caller, "talents", "edit")) &&
      (await hasModule(admin, caller, "assignments", "edit"));
    if (!canLink) {
      return json({ error: "Adding reporting lines needs edit access to Users, Talents and Assignments." }, 403);
    }

    const body = (await req.json().catch(() => null)) as { rows?: unknown } | null;
    if (!body || !Array.isArray(body.rows) || body.rows.length === 0) return json({ error: "No rows were sent." }, 400);
    if (body.rows.length > MAX_ROWS) return json({ error: `Send at most ${MAX_ROWS} rows at a time.` }, 400);
    const rows = body.rows.map(parseRow).filter((r): r is LinkRow => r !== null);

    const emails = [...new Set(rows.flatMap((r) => [r.email, r.managerEmail ?? "", ...r.directReports, ...r.peers]).filter(Boolean))];
    const { data: profileRows, error: profileError } = await admin
      .from("profiles")
      .select("id, email, activated_at")
      .in("email", emails);
    if (profileError) throw new Error(`Could not load accounts: ${profileError.message}`);
    const people = new Map(((profileRows ?? []) as Person[]).map((p) => [p.email.toLowerCase(), p]));

    const { data: cycleRows, error: cycleError } = await admin.from("cycles").select("id, status").in("status", ["open", "draft"]);
    if (cycleError) throw new Error(`Could not load cycles: ${cycleError.message}`);
    const cycles = (cycleRows ?? []) as { id: string; status: string }[];

    const results: RowResult[] = [];
    for (const row of rows) {
      try {
        results.push(await linkRow(admin, caller.id, row, people, cycles));
      } catch (error) {
        console.error("bulk link row failed:", error instanceof Error ? error.message : error);
        results.push({ row: row.row, email: row.email, status: "failed", message: "Unexpected error while adding reporting lines." });
      }
    }
    return json({ results }, 200);
  } catch (error) {
    if (error instanceof AccessError) return json({ error: error.message }, error.status);
    console.error("bulk-link-people failed:", error instanceof Error ? error.message : error);
    return json({ error: "Unexpected error while adding reporting lines." }, 500);
  }
});
