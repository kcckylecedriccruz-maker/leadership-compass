const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const CODE_REQUESTED_MESSAGE = "If you've been invited, we've emailed you a 6-digit code.";

export type ActivationResult = { ok: true; message: string } | { ok: false; error: string };

const CONNECTION_ERROR = 'We could not reach the server. Check your connection and try again.';

async function callActivationFunction(name: string, body: unknown): Promise<ActivationResult> {
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify(body),
    });
    const payload: unknown = await response.json().catch(() => null);
    const record = typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {};
    // activate-account answers { email } and request-activation-code answers { message }: both mean success.
    if (response.ok) return { ok: true, message: typeof record.message === 'string' ? record.message : '' };
    if (typeof record.error === 'string') return { ok: false, error: record.error };
    return { ok: false, error: 'Something went wrong. Please try again.' };
  } catch {
    return { ok: false, error: CONNECTION_ERROR };
  }
}

export function requestActivationCode(email: string): Promise<ActivationResult> {
  return callActivationFunction('request-activation-code', { email: email.trim() });
}

export function activateAccount(email: string, code: string, password: string): Promise<ActivationResult> {
  return callActivationFunction('activate-account', { email: email.trim(), code, password });
}
