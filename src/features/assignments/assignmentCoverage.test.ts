import { describe, expect, it } from 'vitest';
import { coverageGroups, isIncomplete } from '@/features/assignments/assignmentCoverage';
import type { AssignmentRecord } from '@/lib/records';

function assignment(classification: AssignmentRecord['classification'], status: AssignmentRecord['status']): AssignmentRecord {
  return { id: `${classification}-${status}-${Math.random()}`, talent_id: 't1', classification, status, assessor: null };
}

describe('assessment completeness', () => {
  const allSubmitted = [
    assignment('immediate_manager', 'submitted'),
    assignment('direct_report', 'submitted'),
    assignment('peer', 'submitted'),
  ];

  it('is complete when every group is covered and everyone has submitted', () => {
    expect(isIncomplete(coverageGroups(allSubmitted, 1), allSubmitted)).toBe(false);
  });

  it('is incomplete when a required group has nobody', () => {
    const noManager = allSubmitted.filter((a) => a.classification !== 'immediate_manager');
    expect(isIncomplete(coverageGroups(noManager, 1), noManager)).toBe(true);
  });

  it('becomes incomplete again when a new assessor has not submitted yet', () => {
    const withNew = [...allSubmitted, assignment('immediate_manager', 'not_started')];
    expect(isIncomplete(coverageGroups(withNew, 1), withNew)).toBe(true);
  });
});
