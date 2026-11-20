import { supabase } from '@/lib/supabase';

export type ScoreRow = {
  talent_id: string;
  competency_id: string;
  category: string;
  competency_name: string;
  sort_order: number;
  self_score: number | null;
  manager_score: number | null;
  peer_score: number | null;
  direct_report_score: number | null;
  external_score: number | null;
  others_score: number | null;
  gap_to_target: number | null;
  band: string | null;
  perception: string | null;
};

export type ReadinessRow = {
  talent_id: string;
  talent_name: string;
  leading_self_gap: number | null;
  leading_others_gap: number | null;
  leading_business_gap: number | null;
  leading_change_gap: number | null;
  overall_gap: number | null;
  categories_above_one: number;
  status: string;
  rank: number;
  /** employee, outside (evaluated outside person) or deleted (account removed; report kept). */
  category: 'employee' | 'outside' | 'deleted';
};

export type NoteRow = {
  classification: string;
  competency_id: string;
  competency_name: string;
  category: string;
  sort_order: number;
  note: string;
};

export type ActionRow = {
  competency_id: string;
  on_the_job: string;
  coaching: string;
  learning: string;
  measure: string;
};

export type CycleOption = { id: string; name: string; status: string; closes_at: string };

export type ReportData = {
  cycle: CycleOption;
  talentId: string;
  talentName: string;
  scores: ScoreRow[];
  readiness: ReadinessRow;
  notes: NoteRow[];
  actions: ActionRow[];
};

async function rpcRows<T>(name: string, args: Record<string, string>): Promise<T[]> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(`Could not load ${name}: ${error.message}`);
  if (!Array.isArray(data)) throw new Error(`Unexpected response from ${name}`);
  return data as T[];
}

export async function loadReadinessRows(cycleId: string): Promise<ReadinessRow[]> {
  return rpcRows<ReadinessRow>('readiness_ranking', { p_cycle_id: cycleId });
}

export async function loadCycleOptions(): Promise<CycleOption[]> {
  const { data, error } = await supabase
    .from('cycles')
    .select('id, name, status, closes_at')
    .order('opens_at', { ascending: false });
  if (error) throw new Error(`Could not load cycles: ${error.message}`);
  return (data ?? []) as CycleOption[];
}

export async function loadReportData(cycleId: string, talentId: string): Promise<ReportData> {
  const [cycleResult, readinessRows, scoreRows, notes, actions] = await Promise.all([
    supabase.from('cycles').select('id, name, status, closes_at').eq('id', cycleId).maybeSingle(),
    rpcRows<ReadinessRow>('readiness_ranking', { p_cycle_id: cycleId }),
    rpcRows<ScoreRow>('competency_scores', { p_cycle_id: cycleId }),
    rpcRows<NoteRow>('behaviour_notes', { p_cycle_id: cycleId, p_talent_id: talentId }),
    supabase.from('action_library').select('competency_id, on_the_job, coaching, learning, measure'),
  ]);

  if (cycleResult.error || !cycleResult.data) throw new Error('The cycle could not be loaded.');
  if (actions.error) throw new Error(`Could not load actions: ${actions.error.message}`);

  const readiness = readinessRows.find((row) => row.talent_id === talentId);
  if (!readiness) throw new Error('This report is not available.');

  return {
    cycle: cycleResult.data as CycleOption,
    talentId,
    talentName: readiness.talent_name,
    scores: scoreRows
      .filter((row) => row.talent_id === talentId)
      .sort((a, b) => a.sort_order - b.sort_order),
    readiness,
    notes,
    actions: (actions.data ?? []) as ActionRow[],
  };
}
