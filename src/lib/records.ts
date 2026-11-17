export const CLASSIFICATIONS = ['immediate_manager', 'direct_report', 'peer', 'self'] as const;
export type Classification = (typeof CLASSIFICATIONS)[number];

export const CYCLE_STATUSES = ['draft', 'open', 'closed'] as const;
export type CycleStatus = (typeof CYCLE_STATUSES)[number];

export type AssignmentStatus = 'not_started' | 'draft' | 'submitted';

export type ProfileRef = {
  id: string;
  full_name: string;
  email: string;
};

export type PersonRef = ProfileRef & { activated_at: string | null };

export type CycleRecord = {
  id: string;
  name: string;
  opens_at: string;
  closes_at: string;
  status: CycleStatus;
  reminder_every_days: number;
  alert_on_submit: boolean;
  min_group_size: number;
};

export type TalentManagerRecord = {
  manager_profile_id: string;
  is_primary: boolean;
  profile: ProfileRef;
};

export type TalentRecord = {
  id: string;
  profile_id: string;
  department: string | null;
  position: string | null;
  immediate_manager_id: string | null;
  profile: PersonRef;
  managers: TalentManagerRecord[];
};

export type CompetencyRecord = {
  id: string;
  category: string;
  name: string;
  definition: string;
  sort_order: number;
};

export type AssignmentRecord = {
  id: string;
  talent_id: string;
  classification: Classification;
  status: AssignmentStatus;
  assessor: PersonRef | null;
};
