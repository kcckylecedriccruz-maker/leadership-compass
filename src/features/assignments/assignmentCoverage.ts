import type { AssignmentRecord, Classification } from '@/lib/records';

export type CoverageGroup = {
  classification: Classification;
  label: string;
  count: number;
  present: boolean;
  hidden: boolean;
};

const REQUIRED_GROUPS: { classification: Classification; label: string; anonymous: boolean }[] = [
  { classification: 'immediate_manager', label: 'Manager', anonymous: false },
  { classification: 'direct_report', label: 'Direct report', anonymous: true },
  { classification: 'peer', label: 'Peer', anonymous: true },
];

export function coverageGroups(assignments: AssignmentRecord[], minGroupSize: number): CoverageGroup[] {
  return REQUIRED_GROUPS.map((group) => {
    const count = assignments.filter((item) => item.classification === group.classification).length;
    return {
      classification: group.classification,
      label: group.label,
      count,
      present: count > 0,
      hidden: group.anonymous && count > 0 && count < minGroupSize,
    };
  });
}

/** Incomplete until every required group has someone assigned and every assessor has submitted. */
export function isIncomplete(groups: CoverageGroup[], assignments: Pick<AssignmentRecord, 'status'>[]): boolean {
  return groups.some((group) => !group.present) || assignments.some((item) => item.status !== 'submitted');
}
