import { supabase } from '@/lib/supabase';
import type { CycleRecord } from '@/lib/records';

export async function loadCycles(): Promise<CycleRecord[]> {
  const { data, error } = await supabase
    .from('cycles')
    .select(
      'id, name, opens_at, closes_at, status, reminder_every_days, alert_on_submit, min_group_size, include_self, include_manager, include_skip_level, include_upward, include_upward_skip, include_peers, evaluations_generated_at',
    )
    .order('opens_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as CycleRecord[];
}
