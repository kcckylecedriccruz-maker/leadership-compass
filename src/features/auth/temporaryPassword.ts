const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const GENERIC_TEMPORARY_PASSWORD_MESSAGE =
  "If an account exists for that email, we've sent a temporary password. It expires in 24 hours.";

export async function requestTemporaryPassword(email: string, accessToken?: string): Promise<string> {
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/forgot-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${accessToken ?? SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ email: email.trim() }),
    });
    const payload: unknown = await response.json().catch(() => null);
    if (response.status === 400 && typeof payload === 'object' && payload !== null && 'error' in payload) {
      return String(payload.error);
    }
    return GENERIC_TEMPORARY_PASSWORD_MESSAGE;
  } catch {
    return 'We could not send a temporary password. Check your connection and try again.';
  }
}
