import type { ActionResult } from '@/features/assessments/assessmentActions';
import type { Answer, AnswerMap, SubmitItem } from '@/features/assessments/assessmentModel';
import type { FunctionResult } from '@/lib/edgeFunctions';
import type { AssignmentStatus, Classification, CompetencyRecord } from '@/lib/records';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const CONNECTION_ERROR = 'We could not reach the server. Check your connection and try again.';

export type LinkAssessment = {
  id: string;
  status: AssignmentStatus;
  classification: Classification;
  talent: { id: string; full_name: string; department: string | null; position: string | null };
};

export type LinkSession = {
  person: { full_name: string; person_type: 'employee' | 'external'; activated: boolean };
  cycle: { id: string; name: string; closes_at: string; status: 'open' | 'closed' };
  assessments: LinkAssessment[];
};

/** Calls the public evaluation-link function. The token in the URL is the only credential. */
async function call(token: string, action: string, extra: Record<string, unknown> = {}): Promise<FunctionResult<unknown>> {
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/evaluation-link`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ token, action, ...extra }),
    });
    const payload: unknown = await response.json().catch(() => null);
    if (response.ok) return { ok: true, data: payload };
    const record = typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {};
    return {
      ok: false,
      message: typeof record.error === 'string' ? record.error : 'Something went wrong. Please try again.',
      payload,
    };
  } catch {
    return { ok: false, message: CONNECTION_ERROR, payload: null };
  }
}

function toAction(result: FunctionResult<unknown>): ActionResult {
  return result.ok ? { ok: true } : { ok: false, message: result.message };
}

export async function openLink(token: string): Promise<LinkSession> {
  const result = await call(token, 'open');
  if (!result.ok) throw new Error(result.message);
  return result.data as LinkSession;
}

export async function loadLinkForm(
  token: string,
  assignmentId: string,
): Promise<{ competencies: CompetencyRecord[]; answers: AnswerMap }> {
  const result = await call(token, 'load', { assignment_id: assignmentId });
  if (!result.ok) throw new Error(result.message);
  const data = result.data as {
    competencies: CompetencyRecord[];
    responses: { competency_id: string; rating: number | null; behaviour_note: string | null }[];
  };
  const numberById = new Map(data.competencies.map((c) => [c.id, c.sort_order]));
  const answers: AnswerMap = {};
  for (const row of data.responses) {
    const number = numberById.get(row.competency_id);
    if (number === undefined) continue;
    const answer: Answer = { rating: row.rating, note: row.behaviour_note ?? '' };
    answers[number] = answer;
  }
  return { competencies: data.competencies, answers };
}

export function linkActions(token: string, assignmentId: string) {
  return {
    save: async (items: SubmitItem[]) => toAction(await call(token, 'save', { assignment_id: assignmentId, responses: items })),
    clear: async () => toAction(await call(token, 'clear', { assignment_id: assignmentId })),
    submit: (copyRequested: boolean, items: SubmitItem[]) =>
      call(token, 'submit', { assignment_id: assignmentId, copy_requested: copyRequested, responses: items }),
    reopen: async () => toAction(await call(token, 'reopen', { assignment_id: assignmentId })),
  };
}

/** Token from /e/<token>. */
export function linkTokenFromPath(pathname: string): string | null {
  const match = /^\/e\/([^/]+)\/?$/.exec(pathname);
  return match ? decodeURIComponent(match[1]) : null;
}
