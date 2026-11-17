import { supabase } from '@/lib/supabase';
import type { TalentRecord } from '@/lib/records';

export async function loadTalents(): Promise<TalentRecord[]> {
  const { data, error } = await supabase
    .from('talents')
    .select(
      'id, profile_id, department, position, immediate_manager_id, profile:profiles!profile_id(id, full_name, email, activated_at), managers:talent_managers(manager_profile_id, is_primary, profile:profiles!manager_profile_id(id, full_name, email))',
    );
  if (error) throw error;
  // Embedded profiles on single-person foreign keys come back as one object, not an array.
  return ((data ?? []) as unknown as TalentRecord[])
    .map((talent) => ({
      ...talent,
      managers: [...talent.managers].sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.profile.full_name.localeCompare(b.profile.full_name)),
    }))
    .sort((a, b) => a.profile.full_name.localeCompare(b.profile.full_name));
}
