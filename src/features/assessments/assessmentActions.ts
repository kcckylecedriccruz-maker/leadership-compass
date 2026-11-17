import type { SubmitItem } from '@/features/assessments/assessmentModel';
import { callEdgeFunction, isRecord, type FunctionResult } from '@/lib/edgeFunctions';
import { databaseErrorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

export type ActionResult = { ok: true } | { ok: false; message: string };

export async function saveAssessmentDraft(assignmentId: string, items: SubmitItem[]): Promise<ActionResult> {
  const { error } = await supabase.rpc('save_assessment_draft', {
    p_assignment_id: assignmentId,
    p_responses: items,
  });
  return error ? { ok: false, message: databaseErrorMessage(error) } : { ok: true };
}

export async function clearAssessmentDraft(assignmentId: string): Promise<ActionResult> {
  const { error } = await supabase.rpc('clear_assessment_draft', { p_assignment_id: assignmentId });
  return error ? { ok: false, message: databaseErrorMessage(error) } : { ok: true };
}

export type SubmitResult = { status: 'submitted'; assignment_id: string };

export function submitAssessment(
  assignmentId: string,
  copyRequested: boolean,
  items: SubmitItem[],
): Promise<FunctionResult<SubmitResult>> {
  return callEdgeFunction(
    'submit-assessment',
    { assignment_id: assignmentId, copy_requested: copyRequested, responses: items },
    isSubmitResult,
  );
}

export type ReopenResult = { assignment_id: string; status: 'draft'; talent_name: string; cycle_name: string };

export function reopenAssessment(token: string): Promise<FunctionResult<ReopenResult>> {
  return callEdgeFunction('reopen-assessment', { token }, isReopenResult);
}

export function missingItemNumbers(payload: unknown): number[] {
  if (!isRecord(payload)) return [];
  const numbers = [...readNumbers(payload.rating_missing), ...readNumbers(payload.note_missing)];
  return [...new Set(numbers)].sort((a, b) => a - b);
}

function readNumbers(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is number => typeof item === 'number');
}

function isSubmitResult(value: unknown): value is SubmitResult {
  return isRecord(value) && value.status === 'submitted' && typeof value.assignment_id === 'string';
}

function isReopenResult(value: unknown): value is ReopenResult {
  return (
    isRecord(value) &&
    typeof value.assignment_id === 'string' &&
    value.status === 'draft' &&
    typeof value.talent_name === 'string' &&
    typeof value.cycle_name === 'string'
  );
}
