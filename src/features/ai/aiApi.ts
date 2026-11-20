import { callEdgeFunction, isRecord } from '@/lib/edgeFunctions';

export type AiResult<T> = { ok: true; data: T } | { ok: false; message: string };

async function call<T>(action: string, body: Record<string, unknown> = {}): Promise<AiResult<T>> {
  const result = await callEdgeFunction('ai-insights', { action, ...body }, isRecord);
  return result.ok ? { ok: true, data: result.data as T } : { ok: false, message: result.message };
}

export type Evidence = { competency: string; evidence: string };

export type PersonSummary = {
  overview: string;
  strengths: Evidence[];
  development_areas: Evidence[];
  blind_spots: { competency: string; explanation: string }[];
  plan_30_days: string[];
  plan_60_days: string[];
  plan_90_days: string[];
};

export type CycleInsights = {
  overview: string;
  strengths: Evidence[];
  needs: Evidence[];
  note_themes: { theme: string; description: string; competencies: string[]; kind: 'strength' | 'development' }[];
  training_suggestions: string[];
  caveats: string;
  notes_used?: number;
  answers_total?: number;
};

export type CompetencyHelp = { plain: string; looks_like: string[]; not_like: string[]; think_about: string };

export type CoachResult = { verdict: 'good' | 'improve'; issues: string[]; suggestion: string; identifying_risk: boolean };

export type AskResult = { answer: string; key_figures: { label: string; value: string }[]; caveats: string };

export type CompareResult = {
  overview: string;
  improved: { competency: string; change: string; note: string }[];
  declined: { competency: string; change: string; note: string }[];
  unchanged: string;
  recommendations: string[];
};

export type TrendResult = {
  overview: string;
  trends: { competency: string; direction: 'up' | 'down' | 'steady'; detail: string }[];
  self_vs_others: string;
  focus_next: string[];
};

export type TeamResult = {
  overview: string;
  strengths: string[];
  needs: string[];
  per_person: { person: string; highlight: string; suggestion: string }[];
  coaching_tips: string[];
};

export const generatePersonSummary = (cycleId: string, talentId: string) =>
  call<{ content: PersonSummary; generated_at: string }>('person_summary', { cycle_id: cycleId, talent_id: talentId });
export const generateCycleInsights = (cycleId: string) =>
  call<{ content: CycleInsights; generated_at: string }>('cycle_insights', { cycle_id: cycleId });
export const draftExplanations = (competencyId?: string) =>
  call<{ saved: number }>('explain_draft', competencyId ? { competency_id: competencyId } : {});
export const saveExplanation = (competencyId: string, help: CompetencyHelp) =>
  call<{ help: CompetencyHelp | null }>('save_help', { competency_id: competencyId, help });
export const askInsights = (question: string) => call<AskResult>('ask', { question });
export const compareCycles = (cycleA: string, cycleB: string, scope: string, value: string) =>
  call<CompareResult>('compare_cycles', { cycle_a: cycleA, cycle_b: cycleB, scope, value });
export const personTrend = (talentId: string) => call<TrendResult>('person_trend', { talent_id: talentId });
export const teamInsights = (cycleId?: string) => call<TeamResult>('team_insights', cycleId ? { cycle_id: cycleId } : {});
export const coachNoteSignedIn = (competencyId: string, note: string, relationship: string) =>
  call<CoachResult>('coach_note', { competency_id: competencyId, note, relationship });

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

/** The note coach for people on the secure-link page (no sign-in; the link token is the credential). */
export async function coachNoteByLink(token: string, competencyId: string, note: string, relationship: string): Promise<AiResult<CoachResult>> {
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/ai-insights`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
      body: JSON.stringify({ action: 'coach_note', token, competency_id: competencyId, note, relationship }),
    });
    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (response.ok && payload) return { ok: true, data: payload as unknown as CoachResult };
    return { ok: false, message: typeof payload?.error === 'string' ? payload.error : 'The AI coach is not available right now.' };
  } catch {
    return { ok: false, message: 'We could not reach the server. Check your connection and try again.' };
  }
}

// ---- Help while filling a form (signed in, or by secure link with the token) --------------------

export type HelpMessage = { role: 'assessor' | 'assistant'; text: string };
export type HelpResult = { answer: string; suggested_rating: number | null; rating_reason: string };
export type BehaviourResult = { scenarios: { scenario: string; examples: string[]; starters: string[] }[] };
export type HelpLanguage = 'en' | 'fil';

/** Calls a form-help action as the signed-in user, or with the secure-link token when there is one. */
async function formAi<T>(action: string, body: Record<string, unknown>, token?: string): Promise<AiResult<T>> {
  if (!token) return call<T>(action, body);
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/ai-insights`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
      body: JSON.stringify({ action, token, ...body }),
    });
    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (response.ok && payload) return { ok: true, data: payload as unknown as T };
    return { ok: false, message: typeof payload?.error === 'string' ? payload.error : 'The AI helper is not available right now.' };
  } catch {
    return { ok: false, message: 'We could not reach the server. Check your connection and try again.' };
  }
}

export type FormAi = {
  ask: (competencyId: string, messages: HelpMessage[], language: HelpLanguage) => Promise<AiResult<HelpResult>>;
  suggestRating: (competencyId: string, note: string, language: HelpLanguage) => Promise<AiResult<HelpResult>>;
  behaviours: (competencyId: string, rating: number | null, keywords: string, language: HelpLanguage) => Promise<AiResult<BehaviourResult>>;
};

/** AI help for one form (assignment). Pass the secure-link token on the link page. */
export function formAiFor(assignmentId: string, token?: string): FormAi {
  return {
    ask: (competencyId, messages, language) =>
      formAi('question_help', { assignment_id: assignmentId, competency_id: competencyId, messages, language }, token),
    suggestRating: (competencyId, note, language) =>
      formAi('question_help', { assignment_id: assignmentId, competency_id: competencyId, messages: [], note, suggest_rating: true, language }, token),
    behaviours: (competencyId, rating, keywords, language) =>
      formAi('suggest_behaviours', { assignment_id: assignmentId, competency_id: competencyId, rating, keywords, language }, token),
  };
}
