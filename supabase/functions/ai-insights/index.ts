// AI features powered by Claude.
//
// Admins:  person_summary, cycle_insights, explain_draft, save_help, ask, compare_cycles, person_trend
// Managers (reports shared with them): team_insights
// Anyone filling a form (signed in or by secure link): coach_note
//
// Names never reach Claude: free text is scrubbed of everyone's names and people in data are replaced by codes
// like [P3], which are swapped back to names after Claude answers.

import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.57.4";
import { AccessError, type Caller, callerFromRequest } from "../_shared/access.ts";
import { AiError, askJson, MODEL, S } from "../_shared/claude.ts";
import { LinkError, resolveLink } from "../_shared/evaluationLinks.ts";
import {
  type Answer,
  type Competency,
  loadAnswers,
  loadCompetencies,
  loadPeople,
  nameScrubber,
  overall,
  Pseudonyms,
  sample,
  scoreCompetencies,
} from "./data.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Admin = SupabaseClient;
type Body = Record<string, unknown>;

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function uuid(body: Body, key: string, label: string): string {
  const v = body[key];
  if (typeof v !== "string" || !UUID.test(v)) throw new AccessError(400, `Choose a ${label}.`);
  return v;
}

function requireAdmin(caller: Caller) {
  if (caller.role !== "admin") throw new AccessError(403, "Only administrators can use this AI feature.");
}

const STYLE =
  "Write in plain, warm, professional English for a Philippine workplace. Be specific and practical. Never invent facts: base every claim on the data given. Never guess who wrote a comment or name raters. People appear as codes like [P3]; keep those codes exactly as given and never invent names. '[name]' marks a removed name.";

// ---- 1. Feedback summary and development plan -------------------------------------------------

async function personSummary(admin: Admin, caller: Caller, body: Body) {
  requireAdmin(caller);
  const cycleId = uuid(body, "cycle_id", "cycle");
  const talentId = uuid(body, "talent_id", "person");
  const [competencies, answers, scrub, actions] = await Promise.all([
    loadCompetencies(admin),
    loadAnswers(admin, cycleId, [talentId]),
    nameScrubber(admin),
    admin.from("action_library").select("competency_id, on_the_job, coaching, learning, measure"),
  ]);
  if (answers.filter((a) => a.group !== "Self").length === 0) {
    throw new AccessError(409, "There is no submitted feedback from others yet, so there is nothing to summarise.");
  }
  const actionsBy = new Map(((actions.data ?? []) as { competency_id: string }[]).map((a) => [a.competency_id, a]));
  const input = competencies.map((c) => {
    const rows = answers.filter((a) => a.competencyId === c.id);
    const score = scoreCompetencies(rows, [c])[0];
    return {
      competency: c.name,
      category: c.category,
      definition: c.definition,
      scores: { self: score.self, others: score.others, ...score.byGroup },
      notes: rows.map((r) => ({ from: r.group, note: scrub(r.note) })),
      suggested_actions: actionsBy.get(c.id) ?? null,
    };
  });

  const schema = S.obj({
    overview: S.str,
    strengths: S.arr(S.obj({ competency: S.str, evidence: S.str })),
    development_areas: S.arr(S.obj({ competency: S.str, evidence: S.str })),
    blind_spots: S.arr(S.obj({ competency: S.str, explanation: S.str })),
    plan_30_days: S.strs,
    plan_60_days: S.strs,
    plan_90_days: S.strs,
  });
  const content = await askJson({
    system: `You are an experienced leadership development coach writing the summary of a 360-degree feedback report for one employee. ${STYLE}`,
    user: `Here is the employee's feedback for one review cycle: ratings (1 = rarely, 5 = always) by rater group, the written behaviour examples, and suggested actions from the organisation's action library.

Write:
- overview: 3-4 sentences on the overall picture.
- strengths: 3-4 competencies that others rate highest, each with the evidence (scores and recurring themes in the notes).
- development_areas: 3-4 competencies that most need work, with evidence.
- blind_spots: competencies where self-rating is at least 1 point above others' rating (or hidden strengths where it is 1 below); explain what the notes suggest. Empty list if none.
- plan_30_days / plan_60_days / plan_90_days: 2-4 concrete actions each, building on the development areas and the suggested actions, adapted to what the notes describe.
Never quote a note word for word if it could identify its writer; paraphrase themes instead.

<feedback>
${JSON.stringify(input)}
</feedback>`,
    schema,
    effort: "high",
  });

  const { error } = await admin
    .from("ai_person_summaries")
    .upsert({ cycle_id: cycleId, talent_id: talentId, content, model: MODEL, generated_by: caller.id, generated_at: new Date().toISOString() }, { onConflict: "cycle_id,talent_id" });
  if (error) throw new Error(`Could not save the summary: ${error.message}`);
  await audit(admin, caller.id, "ai.person_summary", talentId, { cycle_id: cycleId });
  return { content, generated_at: new Date().toISOString() };
}

// ---- 2. Note coach -----------------------------------------------------------------------------

async function coachNote(admin: Admin, req: Request, body: Body) {
  // Signed in, or holding a valid secure link.
  if (typeof body.token === "string") {
    const link = await resolveLink(admin, body.token);
    if (link.cycle.status !== "open") throw new AccessError(409, "This cycle has closed.");
  } else {
    const caller = await callerFromRequest(admin, req);
    if (!caller.isActive) throw new AccessError(403, "Your account is deactivated.");
  }
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (note.length < 3) throw new AccessError(400, "Write a few words first, then ask for help.");
  if (note.length > 2000) throw new AccessError(400, "Notes can be up to 2000 characters.");
  const competencyId = uuid(body, "competency_id", "competency");
  const { data: competency } = await admin.from("competencies").select("name, definition").eq("id", competencyId).maybeSingle();
  if (!competency) throw new AccessError(404, "That competency could not be found.");
  const self = body.relationship === "self";
  const scrub = await nameScrubber(admin);

  const schema = S.obj({
    verdict: S.oneOf(["good", "improve"]),
    issues: S.strs,
    suggestion: S.str,
    identifying_risk: { type: "boolean" },
  });
  return await askJson({
    system: `You coach people writing feedback in a leadership 360 assessment. A good behaviour example is specific and observable (situation, what the person did, the effect), respectful, about behaviour rather than personality, and does not reveal who wrote it. ${STYLE}`,
    user: `Competency: ${competency.name} - ${competency.definition}
Written ${self ? "by the employee about themselves (self-assessment)" : "about a colleague"}.

Check this behaviour example and suggest an improved version that keeps the writer's meaning and facts (do not add new facts; where details are missing, leave a short placeholder like [describe the situation]).
- verdict: "good" if it is already specific and respectful, else "improve".
- issues: short reasons (empty if good).
- suggestion: the improved text (or the original if good).
- identifying_risk: true if it contains details that could reveal who wrote it (for anonymous feedback).

<note>
${scrub(note)}
</note>`,
    schema,
    effort: "low",
    maxTokens: 4000,
  });
}

// ---- 3. Plain-English explanations per competency ---------------------------------------------


async function explainDraft(admin: Admin, caller: Caller, body: Body) {
  requireAdmin(caller);
  const competencies = await loadCompetencies(admin);
  const only = typeof body.competency_id === "string" ? competencies.filter((c) => c.id === body.competency_id) : competencies;
  if (only.length === 0) throw new AccessError(404, "That competency could not be found.");
  const result = await askJson<{ items: { sort_order: number; plain: string; looks_like: string[]; not_like: string[]; think_about: string }[] }>({
    system: `You help people understand the items in a leadership feedback form so they can rate fairly. ${STYLE}`,
    user: `For each competency below, write help text for someone filling in the form who does not understand the item:
- plain: 1-2 sentences in everyday words (no jargon).
- looks_like: 3 short examples of what this looks like at work.
- not_like: 2 short examples of what it does NOT look like.
- think_about: one prompt that helps the rater recall a real moment ("Think of a time when...").
Return one item per competency with its sort_order.

<competencies>
${JSON.stringify(only.map((c) => ({ sort_order: c.sort_order, name: c.name, category: c.category, definition: c.definition })))}
</competencies>`,
    schema: S.obj({ items: S.arr(S.obj({ sort_order: { type: "integer" }, plain: S.str, looks_like: S.strs, not_like: S.strs, think_about: S.str })) }),
    effort: "medium",
  });
  let saved = 0;
  for (const item of result.items) {
    const c = only.find((x) => x.sort_order === item.sort_order);
    if (!c) continue;
    const help = { plain: item.plain, looks_like: item.looks_like, not_like: item.not_like, think_about: item.think_about };
    const { error } = await admin.from("competencies").update({ help, help_updated_at: new Date().toISOString() }).eq("id", c.id);
    if (!error) saved += 1;
  }
  await audit(admin, caller.id, "ai.explanations_drafted", "competencies", { saved });
  return { saved };
}

function textList(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string").map((v) => v.trim().slice(0, 300)).filter(Boolean).slice(0, max);
}

async function saveHelp(admin: Admin, caller: Caller, body: Body) {
  requireAdmin(caller);
  const competencyId = uuid(body, "competency_id", "competency");
  const raw = (body.help ?? {}) as Record<string, unknown>;
  const help = {
    plain: typeof raw.plain === "string" ? raw.plain.trim().slice(0, 600) : "",
    looks_like: textList(raw.looks_like, 6),
    not_like: textList(raw.not_like, 6),
    think_about: typeof raw.think_about === "string" ? raw.think_about.trim().slice(0, 300) : "",
  };
  const empty = !help.plain && help.looks_like.length === 0 && help.not_like.length === 0 && !help.think_about;
  const { error } = await admin
    .from("competencies")
    .update({ help: empty ? null : help, help_updated_at: new Date().toISOString() })
    .eq("id", competencyId);
  if (error) throw new Error(`Could not save: ${error.message}`);
  await audit(admin, caller.id, "competency.help_edited", competencyId, {});
  return { help: empty ? null : help };
}

// ---- 4. Cycle insights (organisation, including themes from all notes) -------------------------

async function cycleInsights(admin: Admin, caller: Caller, body: Body) {
  requireAdmin(caller);
  const cycleId = uuid(body, "cycle_id", "cycle");
  const [competencies, answers, scrub, people] = await Promise.all([
    loadCompetencies(admin),
    loadAnswers(admin, cycleId),
    nameScrubber(admin),
    loadPeople(admin),
  ]);
  const employees = answers.filter((a) => !people.get(a.talentId)?.outside);
  if (employees.filter((a) => a.group !== "Self").length === 0) throw new AccessError(409, "No feedback has been submitted in this cycle yet.");
  const scores = scoreCompetencies(employees, competencies);
  const NOTES_PER_COMPETENCY = 60;
  let notesSent = 0;
  const notesTotal = employees.length;
  const notes = competencies.map((c) => {
    const rows = sample(employees.filter((a) => a.competencyId === c.id && a.group !== "Self"), NOTES_PER_COMPETENCY);
    notesSent += rows.length;
    return { competency: c.name, notes: rows.map((r) => scrub(r.note)) };
  });

  const schema = S.obj({
    overview: S.str,
    strengths: S.arr(S.obj({ competency: S.str, evidence: S.str })),
    needs: S.arr(S.obj({ competency: S.str, evidence: S.str })),
    note_themes: S.arr(S.obj({ theme: S.str, description: S.str, competencies: S.strs, kind: S.oneOf(["strength", "development"]) })),
    training_suggestions: S.strs,
    caveats: S.str,
  });
  const content = await askJson<Record<string, unknown>>({
    system: `You are an organisational development analyst summarising a leadership 360 review cycle for HR and leadership. ${STYLE}`,
    user: `Below are organisation-wide average ratings per competency (self vs others, by rater group) and a sample of the written behaviour examples others gave (the qualitative feedback).

Write:
- overview: 4-5 sentences on the organisation's leadership picture.
- strengths: 3-4 competencies that are strongest across the organisation, with evidence.
- needs: 3-4 competencies that most need development, with evidence.
- note_themes: 5-8 recurring themes in the written feedback (consolidated qualitative findings), each with a short description, the competencies involved, and whether it is a strength or development theme.
- training_suggestions: 3-5 practical programme or training ideas.
- caveats: limits of the data (e.g. small numbers, sampled notes).

<scores>
${JSON.stringify(scores)}
</scores>
<notes sampled="${notesSent}" of_total="${notesTotal}">
${JSON.stringify(notes)}
</notes>`,
    schema,
    effort: "high",
  });
  const stored = { ...content, notes_used: notesSent, answers_total: notesTotal };
  const { error } = await admin
    .from("ai_cycle_insights")
    .upsert({ cycle_id: cycleId, content: stored, model: MODEL, generated_by: caller.id, generated_at: new Date().toISOString() }, { onConflict: "cycle_id" });
  if (error) throw new Error(`Could not save the insights: ${error.message}`);
  await audit(admin, caller.id, "ai.cycle_insights", cycleId, {});
  return { content: stored, generated_at: new Date().toISOString() };
}

// ---- 5. Insight generator ---------------------------------------------------------------------

type CycleRow = { id: string; name: string; status: string; opens_at: string };

async function loadCycles(admin: Admin): Promise<CycleRow[]> {
  const { data } = await admin.from("cycles").select("id, name, status, opens_at").order("opens_at");
  return (data ?? []) as CycleRow[];
}

/** Scores only (no written notes): per cycle, organisation and per person, with people as codes. */
async function dataPack(admin: Admin, codes: Pseudonyms, onlyTalents?: Set<string>, onlyCycles?: Set<string>) {
  const [cycles, competencies, people] = await Promise.all([loadCycles(admin), loadCompetencies(admin), loadPeople(admin)]);
  const pack = [];
  for (const cycle of cycles) {
    if (onlyCycles && !onlyCycles.has(cycle.id)) continue;
    const answers = (await loadAnswers(admin, cycle.id)).filter((a) => !onlyTalents || onlyTalents.has(a.talentId));
    if (answers.length === 0) continue;
    const byTalent = new Map<string, Answer[]>();
    for (const a of answers) byTalent.set(a.talentId, [...(byTalent.get(a.talentId) ?? []), a]);
    pack.push({
      cycle: cycle.name,
      status: cycle.status,
      organisation: scoreCompetencies(answers, competencies).map((s) => ({ competency: s.competency, self: s.self, others: s.others })),
      people: [...byTalent.entries()].map(([talentId, rows]) => {
        const person = people.get(talentId);
        const scores = scoreCompetencies(rows, competencies);
        return {
          person: codes.code(talentId, person?.name ?? "Unknown"),
          kind: person?.outside ? "outside person" : "employee",
          department: person?.department ?? null,
          position: person?.position ?? null,
          groups: person?.groups ?? [],
          overall: overall(scores),
          competencies: scores.map((s) => ({ competency: s.competency, self: s.self, others: s.others })),
        };
      }),
    });
  }
  return pack;
}

const ANSWER_SCHEMA = S.obj({ answer: S.str, key_figures: S.arr(S.obj({ label: S.str, value: S.str })), caveats: S.str });

async function ask(admin: Admin, caller: Caller, body: Body) {
  requireAdmin(caller);
  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (question.length < 5) throw new AccessError(400, "Type a question.");
  if (question.length > 500) throw new AccessError(400, "Keep the question under 500 characters.");
  const codes = new Pseudonyms();
  const pack = await dataPack(admin, codes);
  if (pack.length === 0) throw new AccessError(409, "There is no submitted feedback yet.");
  const result = await askJson({
    system: `You answer questions about leadership 360 scores for an HR administrator. Use only the data provided (ratings 1-5, 'others' = everyone except the person themselves). If the data cannot answer the question, say so. ${STYLE}`,
    user: `<data>
${JSON.stringify(pack)}
</data>

Question: ${question}

Answer in 2-6 sentences, then list the key figures you used, then caveats (e.g. few responses).`,
    schema: ANSWER_SCHEMA,
    effort: "medium",
  });
  await audit(admin, caller.id, "ai.ask", "insights", {});
  return codes.restore(result);
}

async function compareCycles(admin: Admin, caller: Caller, body: Body) {
  requireAdmin(caller);
  const a = uuid(body, "cycle_a", "first cycle");
  const b = uuid(body, "cycle_b", "second cycle");
  if (a === b) throw new AccessError(400, "Choose two different cycles.");
  const scope = typeof body.scope === "string" ? body.scope : "organisation";
  const value = typeof body.value === "string" ? body.value : "";
  const [cycles, competencies, people] = await Promise.all([loadCycles(admin), loadCompetencies(admin), loadPeople(admin)]);
  const inScope = (talentId: string) => {
    const p = people.get(talentId);
    if (!p) return false;
    if (scope === "group") return p.groups.includes(value);
    if (scope === "department") return (p.department ?? "") === value;
    if (scope === "person") return talentId === value;
    return !p.outside;
  };
  const scoresFor = async (cycleId: string) =>
    scoreCompetencies((await loadAnswers(admin, cycleId)).filter((x) => inScope(x.talentId)), competencies);
  const [first, second] = await Promise.all([scoresFor(a), scoresFor(b)]);
  const rows = competencies.map((c, i) => ({
    competency: c.name,
    before_others: first[i].others,
    after_others: second[i].others,
    change: first[i].others !== null && second[i].others !== null ? Math.round((second[i].others! - first[i].others!) * 100) / 100 : null,
    before_self: first[i].self,
    after_self: second[i].self,
  }));
  if (rows.every((r) => r.before_others === null) || rows.every((r) => r.after_others === null)) {
    throw new AccessError(409, "One of the cycles has no submitted feedback for this selection.");
  }
  const scopeLabel =
    scope === "person" ? "one person" : scope === "group" ? `the group "${value}"` : scope === "department" ? `the ${value} department` : "the whole organisation";
  const result = await askJson({
    system: `You compare leadership 360 results between two review cycles. ${STYLE}`,
    user: `Compare ${cycles.find((c) => c.id === a)?.name} (before) with ${cycles.find((c) => c.id === b)?.name} (after) for ${scopeLabel}. Changes of less than 0.3 are small.

<comparison>
${JSON.stringify(rows)}
</comparison>

Write an overview, the competencies that improved and declined most (with the change), a one-sentence summary of what stayed the same, and 2-4 recommendations.`,
    schema: S.obj({
      overview: S.str,
      improved: S.arr(S.obj({ competency: S.str, change: S.str, note: S.str })),
      declined: S.arr(S.obj({ competency: S.str, change: S.str, note: S.str })),
      unchanged: S.str,
      recommendations: S.strs,
    }),
    effort: "medium",
  });
  await audit(admin, caller.id, "ai.compare_cycles", "insights", { scope });
  return result;
}

async function personTrend(admin: Admin, caller: Caller, body: Body) {
  requireAdmin(caller);
  const talentId = uuid(body, "talent_id", "person");
  const codes = new Pseudonyms();
  const pack = await dataPack(admin, codes, new Set([talentId]));
  if (pack.length < 2) throw new AccessError(409, "This person needs feedback in at least two cycles to show a trend.");
  const result = await askJson({
    system: `You describe how one person's leadership 360 results changed over several review cycles. ${STYLE}`,
    user: `<history>
${JSON.stringify(pack.map((c) => ({ cycle: c.cycle, ...c.people[0] })))}
</history>

Write an overview, a trend per competency that changed noticeably (direction up/down/steady with detail), how the gap between self-view and others' view is changing, and 2-4 focus points for the next cycle.`,
    schema: S.obj({
      overview: S.str,
      trends: S.arr(S.obj({ competency: S.str, direction: S.oneOf(["up", "down", "steady"]), detail: S.str })),
      self_vs_others: S.str,
      focus_next: S.strs,
    }),
    effort: "medium",
  });
  await audit(admin, caller.id, "ai.person_trend", talentId, {});
  return codes.restore(result);
}

/** Managers: insights on the people whose reports an administrator shared with them. */
async function teamInsights(admin: Admin, caller: Caller, body: Body) {
  const cycleId = typeof body.cycle_id === "string" && UUID.test(body.cycle_id) ? body.cycle_id : null;
  let query = admin.from("report_shares").select("cycle_id, talent_id").eq("shared_with", caller.id);
  if (cycleId) query = query.eq("cycle_id", cycleId);
  const { data } = await query;
  const shares = (data ?? []) as { cycle_id: string; talent_id: string }[];
  if (shares.length === 0) throw new AccessError(409, "No reports have been shared with you yet.");
  const codes = new Pseudonyms();
  const pack = await dataPack(admin, codes, new Set(shares.map((s) => s.talent_id)), new Set(shares.map((s) => s.cycle_id)));
  // Keep only the exact person-and-cycle pairs that were shared.
  const allowed = new Set(shares.map((s) => `${s.cycle_id}:${s.talent_id}`));
  const cycles = await loadCycles(admin);
  const idByName = new Map(cycles.map((c) => [c.name, c.id]));
  const people = await loadPeople(admin);
  const codeToTalent = new Map([...people.values()].map((p) => [codes.code(p.talentId, p.name), p.talentId]));
  const filtered = pack.map((c) => ({
    cycle: c.cycle,
    people: c.people.filter((p) => allowed.has(`${idByName.get(c.cycle)}:${codeToTalent.get(p.person)}`)),
  }));
  const result = await askJson({
    system: `You help a manager prepare coaching conversations with their team, using leadership 360 scores that were shared with them. ${STYLE}`,
    user: `<team>
${JSON.stringify(filtered)}
</team>

Write an overview of the team, 2-3 team strengths, 2-3 team development needs, one highlight and one coaching suggestion per person, and 3-4 general coaching tips.`,
    schema: S.obj({
      overview: S.str,
      strengths: S.strs,
      needs: S.strs,
      per_person: S.arr(S.obj({ person: S.str, highlight: S.str, suggestion: S.str })),
      coaching_tips: S.strs,
    }),
    effort: "medium",
  });
  await audit(admin, caller.id, "ai.team_insights", "insights", {});
  return codes.restore(result);
}

async function audit(admin: Admin, actorId: string, action: string, entityId: string, details: Body) {
  await admin.from("audit_log").insert({ actor_id: actorId, action, entity: "ai", entity_id: entityId, details, source: "app" });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  try {
    if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const body = ((await req.json().catch(() => null)) ?? {}) as Body;

    // The note coach also serves people on the secure-link page, who have no sign-in.
    if (body.action === "coach_note") return json(await coachNote(admin, req, body), 200);

    const caller = await callerFromRequest(admin, req);
    if (!caller.isActive) throw new AccessError(403, "Your account is deactivated.");
    switch (body.action) {
      case "person_summary":
        return json(await personSummary(admin, caller, body), 200);
      case "cycle_insights":
        return json(await cycleInsights(admin, caller, body), 200);
      case "explain_draft":
        return json(await explainDraft(admin, caller, body), 200);
      case "save_help":
        return json(await saveHelp(admin, caller, body), 200);
      case "ask":
        return json(await ask(admin, caller, body), 200);
      case "compare_cycles":
        return json(await compareCycles(admin, caller, body), 200);
      case "person_trend":
        return json(await personTrend(admin, caller, body), 200);
      case "team_insights":
        return json(await teamInsights(admin, caller, body), 200);
      default:
        return json({ error: "Unknown action." }, 400);
    }
  } catch (error) {
    if (error instanceof AccessError || error instanceof AiError || error instanceof LinkError) {
      return json({ error: error.message }, error.status);
    }
    console.error("ai-insights failed:", error instanceof Error ? error.message : error);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
});

export type { Competency };
