import { supabase } from '@/lib/supabase';

export type Verdict = 'agree' | 'adjust' | 'disagree';

export type PlanNote = {
  id: string;
  scope: string;
  verdict: Verdict | null;
  note: string;
  visible_to_employee: boolean;
  plan_generated_at: string | null;
  updated_at: string;
  author_id: string | null;
  author: { full_name: string } | null;
};

export const OVERALL = 'overall';

export async function loadPlanNotes(cycleId: string, talentId: string): Promise<PlanNote[]> {
  const { data } = await supabase
    .from('plan_notes')
    .select('id, scope, verdict, note, visible_to_employee, plan_generated_at, updated_at, author_id, author:profiles!author_id(full_name)')
    .eq('cycle_id', cycleId)
    .eq('talent_id', talentId)
    .order('created_at');
  return (data ?? []) as unknown as PlanNote[];
}

export type NoteSummaryRow = { scope: string; agree: number; adjust: number; disagree: number; notes: number };

/** Administrators: verdict counts per competency across all improvement plans. */
export async function loadNoteSummary(): Promise<NoteSummaryRow[]> {
  const { data, error } = await supabase.rpc('plan_note_summary');
  if (error) throw error;
  return (data ?? []) as NoteSummaryRow[];
}
