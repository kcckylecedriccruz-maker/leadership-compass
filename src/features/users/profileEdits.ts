import { callEdgeFunction, isRecord } from '@/lib/edgeFunctions';

type Result<T = Record<string, unknown>> = { ok: true; data: T } | { ok: false; message: string };

async function call(action: string, body: Record<string, unknown>): Promise<Result> {
  const result = await callEdgeFunction('edit-profile', { action, ...body }, isRecord);
  return result.ok ? { ok: true, data: result.data } : { ok: false, message: result.message };
}

export type DetailsInput = {
  full_name: string;
  email: string;
  department: string | null;
  position: string | null;
  manager_id: string | null;
  group_ids: string[];
};

/** Administrators: everything about another person's account in one go. */
export function adminUpdateDetails(userId: string, input: DetailsInput): Promise<Result> {
  return call('admin_update', { user_id: userId, ...input });
}

/** Everyone: their own name, department and position. */
export function updateOwnDetails(input: { full_name: string; department: string | null; position: string | null }): Promise<Result> {
  return call('self_update', input);
}

/** Everyone: email a 6-digit code to the new address. */
export function requestOwnEmailChange(email: string): Promise<Result> {
  return call('self_request_email', { email });
}

/** Everyone: confirm the code; sign-in switches to the new address. */
export function confirmOwnEmailChange(code: string): Promise<Result> {
  return call('self_confirm_email', { code });
}
