import { callEdgeFunction, isRecord, type FunctionResult } from '@/lib/edgeFunctions';
import type { Classification } from '@/lib/records';

export type InviteAssessorBody = {
  cycle_id: string;
  talent_id: string;
  classification: Classification;
  assessor_email: string | null;
  assessor_name: string | null;
  organisation?: string | null;
};

export type InviteAssessorResult = {
  assignment_id: string;
  email_sent: boolean;
  /** Draft cycle: the invitation goes out when the cycle opens. */
  waiting_for_open?: boolean;
};

function isInviteAssessorResult(value: unknown): value is InviteAssessorResult {
  return isRecord(value) && typeof value.assignment_id === 'string' && typeof value.email_sent === 'boolean';
}

export function inviteAssessor(body: InviteAssessorBody): Promise<FunctionResult<InviteAssessorResult>> {
  return callEdgeFunction('invite-assessor', body, isInviteAssessorResult);
}
