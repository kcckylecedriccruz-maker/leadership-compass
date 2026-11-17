import { supabase } from '@/lib/supabase';
import type { CycleRecord } from '@/lib/records';

export async function loadCycles(): Promise<CycleRecord[]> {
  const { data, error } = await supabase
    .from('cycles')
    .select('id, name, opens_at, closes_at, status, reminder_every_days, alert_on_submit, min_group_size')
    .order('opens_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as CycleRecord[];
}
