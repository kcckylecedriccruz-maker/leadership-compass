import { GENERIC_ERROR_MESSAGE } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export type FunctionResult<T> = { ok: true; data: T } | { ok: false; message: string; payload: unknown };

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function callEdgeFunction<T>(
  slug: string,
  body: unknown,
  isExpected: (value: unknown) => value is T,
): Promise<FunctionResult<T>> {
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;
    if (!accessToken) return { ok: false, message: 'Please sign in again.', payload: null };

    const response = await fetch(`${SUPABASE_URL}/functions/v1/${slug}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        apikey: SUPABASE_ANON_KEY,
      },
      body: JSON.stringify(body),
    });
    const payload: unknown = await response.json().catch(() => null);

    if (!response.ok) return { ok: false, message: errorMessageFrom(payload), payload };
    if (!isExpected(payload)) throw new Error(`Unexpected response from ${slug}`);
    return { ok: true, data: payload };
  } catch (cause) {
    console.error(`${slug} request failed`, cause);
    return { ok: false, message: GENERIC_ERROR_MESSAGE, payload: null };
  }
}

function errorMessageFrom(payload: unknown): string {
  if (isRecord(payload) && typeof payload.error === 'string') return payload.error;
  return GENERIC_ERROR_MESSAGE;
}
