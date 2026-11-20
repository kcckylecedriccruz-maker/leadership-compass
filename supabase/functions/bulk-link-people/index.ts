// Bulk upload, phase 2: the org structure.
//
// Runs after bulk-create-users has created (or found) every account, so a row
// can point at people anywhere in the same file. For each row:
// - Immediate manager: sets this person's manager in the org structure.
// - Direct reports: sets each listed person's manager to this person.
// - Peers: adds each listed colleague as an approved peer of this person
//   (Peer evaluations are added to open cycles straight away).
// Department and position are saved on the person. Reporting loops are refused
// by the database. Open cycles keep their snapshot until an admin refreshes them.

import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.57.4";
import { AccessError, callerFromRequest, hasModule } from "../_shared/access.ts";

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
type Person = { id: string; email: string; manager_id: string | null };

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

const emailList = (value: unknown): string[] =>
  Array.isArray(value)
    ? [...new Set(value.filter((v): v is string => typeof v === "string").map((v) => v.trim().toLowerCase()))]
      .filter((v) => EMAIL_PATTERN.test(v))
      .slice(0, 200)
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

function friendly(message: string): string {
  return /reporting loop/i.test(message)
    ? "This would create a reporting loop (someone above this person would report to them)."
    : message;
}

async function setManager(admin: SupabaseClient, personId: string, managerId: string | null): Promise<string | null> {
  const { error } = await admin.from("profiles").update({ manager_id: managerId }).eq("id", personId);
  return error ? friendly(error.message) : null;
}

async function linkRow(admin: SupabaseClient, row: LinkRow, people: Map<string, Person>): Promise<RowResult> {
  const fail = (message: string): RowResult => ({ row: row.row, email: row.email, status: "failed", message });
  const person = people.get(row.email);
  if (!person) return fail("This person's account was not found.");
  const notes: string[] = [];

  if (row.department || row.position) {
    const patch: Record<string, string> = {};
    if (row.department) patch.department = row.department;
    if (row.position) patch.position = row.position;
    await admin.from("profiles").update(patch).eq("id", person.id);
    await admin.from("talents").update(patch).eq("profile_id", person.id);
  }

  if (row.managerEmail) {
    const manager = people.get(row.managerEmail);
    if (!manager) return fail(`Immediate manager ${row.managerEmail} has no account.`);
    if (manager.id === person.id) return fail("A person cannot be their own immediate manager.");
    if (person.manager_id !== manager.id) {
      const problem = await setManager(admin, person.id, manager.id);
      if (problem) return fail(`Immediate manager: ${problem}`);
      person.manager_id = manager.id;
      notes.push(`reports to ${manager.email}`);
    }
  }

  let reportsSet = 0;
  for (const email of row.directReports) {
    const report = people.get(email);
    if (!report) return fail(`Direct report ${email} has no account.`);
    if (report.id === person.id) return fail("A person cannot be their own direct report.");
    if (report.manager_id === person.id) continue;
    const problem = await setManager(admin, report.id, person.id);
    if (problem) return fail(`Direct report ${email}: ${problem}`);
    report.manager_id = person.id;
    reportsSet += 1;
  }
  if (reportsSet > 0) notes.push(`${reportsSet} direct report${reportsSet === 1 ? "" : "s"} set`);

  let peersAdded = 0;
  for (const email of row.peers) {
    const peer = people.get(email);
    if (!peer) return fail(`Peer ${email} has no account.`);
    if (peer.id === person.id) return fail("A person cannot be their own peer.");
    const { error } = await admin.rpc("assign_peer", { p_employee: person.id, p_peer: peer.id });
    if (error) return fail(`Peer ${email}: ${error.message}`);
    peersAdded += 1;
  }
  if (peersAdded > 0) notes.push(`${peersAdded} peer${peersAdded === 1 ? "" : "s"} added`);

  if (notes.length === 0) return { row: row.row, email: row.email, status: "skipped", message: "Org structure already up to date." };
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
    const canLink = (await hasModule(admin, caller, "users", "edit")) && (await hasModule(admin, caller, "talents", "edit"));
    if (!canLink) {
      return json({ error: "Setting the org structure needs edit access to Users and Org structure." }, 403);
    }

    const body = (await req.json().catch(() => null)) as { rows?: unknown } | null;
    if (!body || !Array.isArray(body.rows) || body.rows.length === 0) return json({ error: "No rows were sent." }, 400);
    if (body.rows.length > MAX_ROWS) return json({ error: `Send at most ${MAX_ROWS} rows at a time.` }, 400);
    const rows = body.rows.map(parseRow).filter((r): r is LinkRow => r !== null);

    const emails = [...new Set(rows.flatMap((r) => [r.email, r.managerEmail ?? "", ...r.directReports, ...r.peers]).filter(Boolean))];
    const { data: profileRows, error: profileError } = await admin
      .from("profiles")
      .select("id, email, manager_id")
      .in("email", emails);
    if (profileError) throw new Error(`Could not load accounts: ${profileError.message}`);
    const people = new Map(((profileRows ?? []) as Person[]).map((p) => [p.email.toLowerCase(), p]));

    const results: RowResult[] = [];
    for (const row of rows) {
      try {
        results.push(await linkRow(admin, row, people));
      } catch (error) {
        console.error("bulk link row failed:", error instanceof Error ? error.message : error);
        results.push({ row: row.row, email: row.email, status: "failed", message: "Unexpected error while setting the org structure." });
      }
    }

    await admin.from("audit_log").insert({
      actor_id: caller.id,
      action: "org.bulk_upload",
      entity: "profiles",
      entity_id: null,
      details: { rows: results.length, linked: results.filter((r) => r.status === "linked").length },
      source: "app",
    });
    return json({ results }, 200);
  } catch (error) {
    if (error instanceof AccessError) return json({ error: error.message }, error.status);
    console.error("bulk-link-people failed:", error instanceof Error ? error.message : error);
    return json({ error: "Unexpected error while setting the org structure." }, 500);
  }
});
