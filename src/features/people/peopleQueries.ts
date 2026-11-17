import { supabase } from '@/lib/supabase';
import type { Profile } from '@/lib/types';

export type PersonEntry = {
  id: string;
  full_name: string;
  email: string;
  role: Profile['role'];
  activated_at: string | null;
  isAssessor: boolean;
  talentId: string | null;
  managesTalents: boolean;
  managerNeeded: boolean;
};

type ProfileRow = { id: string; full_name: string; email: string; role: Profile['role']; activated_at: string | null };
type TalentRow = { id: string; profile_id: string };
type ManagerRow = { talent_id: string; manager_profile_id: string };
type AssignmentRow = { assessor_id: string; talent_id: string };

export async function loadPeople(): Promise<PersonEntry[]> {
  const [profilesResult, talentsResult, managersResult, assignmentsResult] = await Promise.all([
    supabase.from('profiles').select('id, full_name, email, role, activated_at').order('full_name'),
    supabase.from('talents').select('id, profile_id'),
    supabase.from('talent_managers').select('talent_id, manager_profile_id'),
    supabase.from('assignments').select('assessor_id, talent_id'),
  ]);
  if (profilesResult.error) throw profilesResult.error;
  if (talentsResult.error) throw talentsResult.error;
  if (managersResult.error) throw managersResult.error;
  if (assignmentsResult.error) throw assignmentsResult.error;

  const profiles = (profilesResult.data ?? []) as ProfileRow[];
  const talents = (talentsResult.data ?? []) as TalentRow[];
  const managerRows = (managersResult.data ?? []) as ManagerRow[];
  const assignments = (assignmentsResult.data ?? []) as AssignmentRow[];

  const talentByProfile = new Map(talents.map((talent) => [talent.profile_id, talent]));
  const talentsWithManager = new Set(managerRows.map((row) => row.talent_id));
  const managerIds = new Set(managerRows.map((row) => row.manager_profile_id));
  const assessorIds = new Set(
    assignments.filter((assignment) => assignment.assessor_id !== assignment.talent_id).map((assignment) => assignment.assessor_id),
  );

  return profiles.map((profile) => {
    const talent = talentByProfile.get(profile.id) ?? null;
    return {
      id: profile.id,
      full_name: profile.full_name,
      email: profile.email,
      role: profile.role,
      activated_at: profile.activated_at,
      isAssessor: profile.role === 'assessor' || assessorIds.has(profile.id),
      talentId: talent?.id ?? null,
      managesTalents: managerIds.has(profile.id),
      managerNeeded: talent !== null && !talentsWithManager.has(talent.id),
    };
  });
}
