import { supabase } from '@/lib/supabase';
import type { AssignmentRecord, ProfileRef } from '@/lib/records';

export async function loadCycleAssignments(cycleId: string): Promise<AssignmentRecord[]> {
  const { data, error } = await supabase
    .from('assignments')
    .select('id, talent_id, classification, status, assessor:profiles!assessor_id(id, full_name, email, activated_at)')
    .eq('cycle_id', cycleId);
  if (error) throw error;
  return ((data ?? []) as unknown as AssignmentRecord[]).sort((a, b) =>
    (a.assessor?.full_name ?? '').localeCompare(b.assessor?.full_name ?? ''),
  );
}

export async function loadKnownPeople(): Promise<ProfileRef[]> {
  const { data, error } = await supabase.from('profiles').select('id, full_name, email').order('full_name');
  if (error) throw error;
  return (data ?? []) as ProfileRef[];
}
