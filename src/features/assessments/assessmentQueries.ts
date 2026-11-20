import type { Answer, AnswerMap } from '@/features/assessments/assessmentModel';
import type { AssignmentStatus, CompetencyRecord, CycleStatus } from '@/lib/records';
import { supabase } from '@/lib/supabase';

export type AssessmentSummary = {
  id: string;
  status: AssignmentStatus;
  classification?: string;
  cycle: { id: string; name: string; closes_at: string; status: CycleStatus };
  talent: { id: string; full_name: string; department: string | null; position: string | null };
};

export type AssessmentDetail = {
  summary: AssessmentSummary;
  competencies: CompetencyRecord[];
  answers: AnswerMap;
};

type SummaryRow = {
  id: string;
  status: AssignmentStatus;
  classification?: string;
  cycle: { id: string; name: string; closes_at: string; status: CycleStatus };
  talent: {
    id: string;
    department: string | null;
    position: string | null;
    profile: { full_name: string };
  };
};

type ResponseRow = {
  competency_id: string;
  rating: number;
  behaviour_note: string;
};

const SUMMARY_SELECT =
  'id, status, classification, cycle:cycles!cycle_id(id, name, closes_at, status), talent:talents!talent_id(id, department, position, profile:profiles!profile_id(full_name))';

function toSummary(row: SummaryRow): AssessmentSummary {
  return {
    id: row.id,
    status: row.status,
    classification: row.classification,
    cycle: row.cycle,
    talent: {
      id: row.talent.id,
      full_name: row.talent.profile.full_name,
      department: row.talent.department,
      position: row.talent.position,
    },
  };
}

export async function loadMyAssessments(assessorId: string): Promise<AssessmentSummary[]> {
  const { data, error } = await supabase.from('assignments').select(SUMMARY_SELECT).eq('assessor_id', assessorId);
  if (error) throw error;
  // Single-person embeds come back as one object, which the untyped client reports as an array.
  const rows = (data ?? []) as unknown as SummaryRow[];
  return rows
    .map(toSummary)
    // Open cycles can be filled in; draft cycles are listed as "not open yet" so nobody wonders where they went.
    .filter((item) => item.cycle.status === 'open' || item.cycle.status === 'draft')
    .sort(
      (a, b) =>
        Number(a.cycle.status !== 'open') - Number(b.cycle.status !== 'open') ||
        a.cycle.closes_at.localeCompare(b.cycle.closes_at) || a.talent.full_name.localeCompare(b.talent.full_name),
    );
}

export async function loadAssessmentDetail(assignmentId: string): Promise<AssessmentDetail | null> {
  const [summaryResult, competencyResult, responseResult] = await Promise.all([
    supabase.from('assignments').select(SUMMARY_SELECT).eq('id', assignmentId).maybeSingle(),
    supabase.from('competencies').select('id, category, name, definition, sort_order, help').order('sort_order'),
    supabase.from('responses').select('competency_id, rating, behaviour_note').eq('assignment_id', assignmentId),
  ]);
  if (summaryResult.error) throw summaryResult.error;
  if (competencyResult.error) throw competencyResult.error;
  if (responseResult.error) throw responseResult.error;
  if (!summaryResult.data) return null;

  const competencies = (competencyResult.data ?? []) as CompetencyRecord[];
  const numberById = new Map(competencies.map((competency) => [competency.id, competency.sort_order]));
  const answers: AnswerMap = {};
  for (const row of (responseResult.data ?? []) as ResponseRow[]) {
    const number = numberById.get(row.competency_id);
    if (number === undefined) continue;
    const answer: Answer = { rating: row.rating, note: row.behaviour_note };
    answers[number] = answer;
  }

  return {
    summary: toSummary(summaryResult.data as unknown as SummaryRow),
    competencies,
    answers,
  };
}
