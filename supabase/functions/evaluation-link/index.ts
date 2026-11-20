import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.57.4";
import { LinkError, resolveLink, type ResolvedLink } from "../_shared/evaluationLinks.ts";
import { parseInput, RequestError, submitForAssessor } from "../_shared/submission.ts";

/**
 * Public endpoint behind the secure email link (/e/<token>). No sign-in: the token identifies one person in one
 * cycle, and every action is limited to that person's own evaluations in that cycle.
 *
 * Actions: open, load, save, clear, submit, reopen.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

type Admin = SupabaseClient;
type Body = Record<string, unknown>;

type AssessmentRow = {
  id: string;
  status: string;
  classification: string;
  talent: { id: string; department: string | null; position: string | null; profile: { full_name: string } };
};

function isOpen(link: ResolvedLink): boolean {
  return link.cycle.status === "open" && Date.parse(link.cycle.closes_at) > Date.now();
}

function assignmentIdOf(body: Body): string {
  const id = body.assignment_id;
  if (typeof id !== "string" || !UUID_PATTERN.test(id)) throw new RequestError(400, "This assessment could not be found.");
  return id;
}

/** The assessment must belong to this link's person and cycle. */
async function ownAssessment(admin: Admin, link: ResolvedLink, assignmentId: string): Promise<{ id: string; status: string }> {
  const { data, error } = await admin
    .from("assignments")
    .select("id, status")
    .eq("id", assignmentId)
    .eq("assessor_id", link.person.id)
    .eq("cycle_id", link.cycle.id)
    .maybeSingle();
  if (error) throw new Error(`Could not load the assessment: ${error.message}`);
  if (!data) throw new RequestError(404, "This assessment could not be found.");
  return data;
}

async function openLink(admin: Admin, link: ResolvedLink) {
  const { data, error } = await admin
    .from("assignments")
    .select("id, status, classification, talent:talents!talent_id(id, department, position, profile:profiles!profile_id(full_name))")
    .eq("assessor_id", link.person.id)
    .eq("cycle_id", link.cycle.id);
  if (error) throw new Error(`Could not load assessments: ${error.message}`);
  const rows = (data ?? []) as unknown as AssessmentRow[];
  return {
    person: {
      full_name: link.person.full_name,
      person_type: link.person.person_type,
      activated: Boolean(link.person.activated_at),
    },
    cycle: { id: link.cycle.id, name: link.cycle.name, closes_at: link.cycle.closes_at, status: isOpen(link) ? "open" : "closed" },
    assessments: rows
      .map((row) => ({
        id: row.id,
        status: row.status,
        classification: row.classification,
        talent: {
          id: row.talent.id,
          full_name: row.talent.profile.full_name,
          department: row.talent.department,
          position: row.talent.position,
        },
      }))
      .sort((a, b) => Number(a.classification !== "self") - Number(b.classification !== "self") || a.talent.full_name.localeCompare(b.talent.full_name)),
  };
}

async function loadDetail(admin: Admin, link: ResolvedLink, assignmentId: string) {
  await ownAssessment(admin, link, assignmentId);
  const [competencies, responses] = await Promise.all([
    admin.from("competencies").select("id, category, name, definition, sort_order, help").order("sort_order"),
    admin.from("responses").select("competency_id, rating, behaviour_note").eq("assignment_id", assignmentId),
  ]);
  if (competencies.error) throw new Error(`Could not load competencies: ${competencies.error.message}`);
  if (responses.error) throw new Error(`Could not load answers: ${responses.error.message}`);
  return { competencies: competencies.data ?? [], responses: responses.data ?? [] };
}

async function audit(admin: Admin, link: ResolvedLink, action: string, assignmentId: string) {
  await admin.from("audit_log").insert({
    actor_id: link.person.id,
    action,
    entity: "assignment",
    entity_id: assignmentId,
    details: { cycle_id: link.cycle.id, via: "link" },
    source: "app",
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  try {
    if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const body = ((await req.json().catch(() => null)) ?? {}) as Body;
    const link = await resolveLink(admin, body.token);
    const action = body.action;

    if (action === "open") return json(await openLink(admin, link), 200);
    if (action === "load") return json(await loadDetail(admin, link, assignmentIdOf(body)), 200);

    if (!isOpen(link)) throw new RequestError(409, "This cycle has closed, so feedback can no longer be changed.");

    if (action === "save" || action === "clear") {
      const assignmentId = assignmentIdOf(body);
      await ownAssessment(admin, link, assignmentId);
      const { error } =
        action === "save"
          ? await admin.rpc("link_save_draft", {
              p_assessor: link.person.id,
              p_assignment_id: assignmentId,
              p_responses: Array.isArray(body.responses) ? body.responses : [],
            })
          : await admin.rpc("link_clear_draft", { p_assessor: link.person.id, p_assignment_id: assignmentId });
      if (error) {
        const known = error.code === "42501" || error.code === "22023";
        throw known ? new RequestError(400, error.message) : new Error(error.message);
      }
      return json({ status: action === "save" ? "draft" : "not_started" }, 200);
    }

    if (action === "submit") {
      const input = parseInput(body);
      const result = await submitForAssessor(
        admin,
        { id: link.person.id, email: link.person.email },
        input,
        { cycleId: link.cycle.id, via: "link" },
      );
      return json(result.body, result.status);
    }

    if (action === "reopen") {
      const assignmentId = assignmentIdOf(body);
      const own = await ownAssessment(admin, link, assignmentId);
      if (own.status !== "submitted") return json({ status: own.status }, 200);
      const { error } = await admin
        .from("assignments")
        .update({ status: "draft", submitted_at: null, edit_token_hash: null })
        .eq("id", assignmentId)
        .eq("status", "submitted");
      if (error) throw new Error(`Could not reopen: ${error.message}`);
      await audit(admin, link, "assignment.reopened", assignmentId);
      return json({ status: "draft" }, 200);
    }

    return json({ error: "Unknown action." }, 400);
  } catch (error) {
    if (error instanceof LinkError) return json({ error: error.message }, error.status);
    if (error instanceof RequestError) return json({ error: error.message, ...error.details }, error.status);
    console.error("evaluation-link failed:", error instanceof Error ? error.message : error);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
});
