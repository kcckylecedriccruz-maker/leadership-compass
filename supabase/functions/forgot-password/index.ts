import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const GENERIC_MESSAGE =
  "If an account exists for that email, we've sent a temporary password. It expires in 24 hours.";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RATE_LIMIT_PER_HOUR = 3;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const PASSWORD_LENGTH = 12;
const PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
const UNBIASED_BYTE_LIMIT = 224;

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function temporaryPassword(): string {
  let password = "";
  while (password.length < PASSWORD_LENGTH) {
    const [byte] = crypto.getRandomValues(new Uint8Array(1));
    if (byte < UNBIASED_BYTE_LIMIT) password += PASSWORD_ALPHABET[byte % PASSWORD_ALPHABET.length];
  }
  return password;
}

async function signedInUserId(admin: SupabaseClient, req: Request): Promise<string | null> {
  const header = req.headers.get("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return null;
  const { data } = await admin.auth.getUser(token);
  return data.user?.id ?? null;
}

async function withinRateLimit(admin: SupabaseClient, email: string): Promise<boolean> {
  const since = new Date(Date.now() - HOUR_MS).toISOString();
  const { count, error } = await admin
    .from("password_reset_requests")
    .select("id", { count: "exact", head: true })
    .eq("email", email)
    .gte("requested_at", since);
  if (error) throw new Error(`Could not check the rate limit: ${error.message}`);
  if ((count ?? 0) >= RATE_LIMIT_PER_HOUR) return false;

  const { error: logError } = await admin.from("password_reset_requests").insert({ email });
  if (logError) throw new Error(`Could not log the request: ${logError.message}`);
  return true;
}

async function sendTemporaryPasswordEmail(email: string, password: string): Promise<void> {
  const secret = Deno.env.get("INTERNAL_SECRET") ?? "";
  const response = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-internal-secret": secret },
    body: JSON.stringify({
      type: "temporary_password",
      recipient_email: email,
      temporary_password: password,
    }),
  });
  if (!response.ok) throw new Error(`send-email responded with ${response.status}`);
}

async function issueTemporaryPassword(admin: SupabaseClient, email: string, actorId: string | null): Promise<void> {
  if (!(await withinRateLimit(admin, email))) return;

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle();
  if (profileError) throw new Error(`Could not load the profile: ${profileError.message}`);
  if (!profile) return;

  const password = temporaryPassword();
  const expiresAt = new Date(Date.now() + DAY_MS).toISOString();

  const { error: authError } = await admin.auth.admin.updateUserById(profile.id, { password });
  if (authError) throw new Error(`Could not set the password: ${authError.message}`);

  const { error: updateError } = await admin
    .from("profiles")
    .update({ must_change_password: true, temp_password_expires_at: expiresAt })
    .eq("id", profile.id);
  if (updateError) throw new Error(`Could not update the profile: ${updateError.message}`);

  const { error: auditError } = await admin.from("audit_log").insert({
    actor_id: actorId,
    action: "profile.temporary_password_issued",
    entity: "profile",
    entity_id: profile.id,
    details: { expires_at: expiresAt, requested_by_admin: actorId !== null },
  });
  if (auditError) throw new Error(`Could not write the audit entry: ${auditError.message}`);

  await sendTemporaryPasswordEmail(email, password);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

    const body = await req.json().catch(() => null);
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!EMAIL_PATTERN.test(email) || email.length > 254) {
      return json({ error: "Enter a valid work email address." }, 400);
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const actorId = await signedInUserId(admin, req);
    await issueTemporaryPassword(admin, email, actorId);
    return json({ message: GENERIC_MESSAGE }, 200);
  } catch (error) {
    console.error("forgot-password failed:", error instanceof Error ? error.message : error);
    return json({ message: GENERIC_MESSAGE }, 200);
  }
});
