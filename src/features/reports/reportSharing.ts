import { databaseErrorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

export type ShareKind = 'consolidated' | 'individual';

export type ReportShare = {
  id: string;
  cycle_id: string;
  talent_id: string;
  shared_with: string;
  kind: ShareKind;
  created_at: string;
  cycle_name: string;
  talent_name: string;
  shared_with_name: string;
};

export type FeedbackRow = {
  assessor_label: string;
  assessor_name: string | null;
  classification: string;
  submitted_at: string | null;
  competency_id: string;
  category: string;
  competency_name: string;
  sort_order: number;
  rating: number;
  note: string;
};

type Row = Record<string, unknown>;
type Result = { ok: true } | { ok: false; message: string };

function one<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

function toShare(row: Row): ReportShare {
  const cycle = one(row.cycle as Row | Row[] | null);
  const talent = one(row.talent as Row | Row[] | null);
  const talentProfile = talent ? one(talent.profile as Row | Row[] | null) : null;
  const recipient = one(row.recipient as Row | Row[] | null);
  return {
    id: String(row.id),
    cycle_id: String(row.cycle_id),
    talent_id: String(row.talent_id),
    shared_with: String(row.shared_with),
    kind: row.kind === 'individual' ? 'individual' : 'consolidated',
    created_at: String(row.created_at ?? ''),
    cycle_name: String(cycle?.name ?? ''),
    talent_name: String(talentProfile?.full_name ?? ''),
    shared_with_name: String(recipient?.full_name ?? ''),
  };
}

const SHARE_SELECT =
  'id, cycle_id, talent_id, shared_with, kind, created_at, cycle:cycles!cycle_id(name), talent:talents!talent_id(profile:profiles!profile_id(full_name)), recipient:profiles!shared_with(full_name)';

/** Reports shared with the signed-in person. */
export async function loadSharedWithMe(userId: string): Promise<ReportShare[]> {
  const { data, error } = await supabase.from('report_shares').select(SHARE_SELECT).eq('shared_with', userId).order('created_at', { ascending: false });
  if (error) throw error;
  return ((data ?? []) as Row[]).map(toShare);
}

/** Every share of one person's report in one cycle (admin view). */
export async function loadSharesFor(cycleId: string, talentId: string): Promise<ReportShare[]> {
  const { data, error } = await supabase.from('report_shares').select(SHARE_SELECT).eq('cycle_id', cycleId).eq('talent_id', talentId);
  if (error) throw error;
  return ((data ?? []) as Row[]).map(toShare);
}

/** The person's immediate and skip-level managers: the only people a report can be shared with. */
export async function loadShareTargets(talentId: string): Promise<{ id: string; name: string; relation: string }[]> {
  const { data: talent } = await supabase.from('talents').select('profile_id').eq('id', talentId).maybeSingle();
  const profileId = (talent as { profile_id: string } | null)?.profile_id;
  if (!profileId) return [];
  const { data: person } = await supabase.from('profiles').select('manager_id, person_type').eq('id', profileId).maybeSingle();
  const row = person as { manager_id: string | null; person_type: string } | null;
  // An outside person's report can go to any active employee.
  if (row?.person_type === 'external') {
    const { data: employees } = await supabase
      .from('profiles')
      .select('id, full_name, position')
      .eq('person_type', 'employee')
      .eq('is_active', true)
      .order('full_name');
    return ((employees ?? []) as { id: string; full_name: string; position: string | null }[]).map((e) => ({
      id: e.id,
      name: e.full_name,
      relation: e.position || 'Employee',
    }));
  }
  const managerId = row?.manager_id;
  if (!managerId) return [];
  const { data: manager } = await supabase.from('profiles').select('id, full_name, manager_id').eq('id', managerId).maybeSingle();
  const m = manager as { id: string; full_name: string; manager_id: string | null } | null;
  if (!m) return [];
  const targets = [{ id: m.id, name: m.full_name, relation: 'Immediate manager' }];
  if (m.manager_id) {
    const { data: skip } = await supabase.from('profiles').select('id, full_name').eq('id', m.manager_id).maybeSingle();
    const s = skip as { id: string; full_name: string } | null;
    if (s) targets.push({ id: s.id, name: s.full_name, relation: 'Skip-level manager' });
  }
  return targets;
}

export async function shareReport(cycleId: string, talentId: string, sharedWith: string, kind: ShareKind): Promise<Result> {
  const { error } = await supabase.rpc('share_report', { p_cycle_id: cycleId, p_talent_id: talentId, p_shared_with: sharedWith, p_kind: kind });
  return error ? { ok: false, message: databaseErrorMessage(error) } : { ok: true };
}

export async function unshareReport(shareId: string): Promise<Result> {
  const { error } = await supabase.rpc('unshare_report', { p_share_id: shareId });
  return error ? { ok: false, message: databaseErrorMessage(error) } : { ok: true };
}

export async function loadIndividualFeedback(cycleId: string, talentId: string): Promise<FeedbackRow[]> {
  const { data, error } = await supabase.rpc('individual_feedback', { p_cycle_id: cycleId, p_talent_id: talentId });
  if (error) throw error;
  return (data ?? []) as FeedbackRow[];
}
