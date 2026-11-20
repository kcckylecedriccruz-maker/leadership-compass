import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const GENERIC_MESSAGE = "If you've been invited, we've emailed you a 6-digit code.";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Every role activates the same way, admins included (admins are created from User control).
const ACTIVATABLE_ROLES = ["admin", "employee"];
const RATE_LIMIT_PER_HOUR = 3;
const CODE_TTL_MS = 15 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const CODE_MODULUS = 1_000_000;
const UNBIASED_LIMIT = 4_294_000_000;

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function activationCode(): string {
  while (true) {
    const [value] = crypto.getRandomValues(new Uint32Array(1));
    if (value < UNBIASED_LIMIT) return String(value % CODE_MODULUS).padStart(6, "0");
  }
}

async function hashCode(email: string, code: string): Promise<string> {
  const data = new TextEncoder().encode(`${email}:${code}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sendEmail(payload: Record<string, unknown>): Promise<void> {
  const response = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-internal-secret": Deno.env.get("INTERNAL_SECRET") ?? "" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`send-email responded with ${response.status}`);
}

async function withinRateLimit(admin: SupabaseClient, email: string): Promise<boolean> {
  const since = new Date(Date.now() - HOUR_MS).toISOString();
  const { count, error } = await admin
    .from("activation_codes")
    .select("id", { count: "exact", head: true })
    .eq("email", email)
    .gte("created_at", since);
  if (error) throw new Error(`Could not check the rate limit: ${error.message}`);
  return (count ?? 0) < RATE_LIMIT_PER_HOUR;
}

async function issueCode(admin: SupabaseClient, email: string): Promise<void> {
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id, role, activated_at")
    .eq("email", email)
    .maybeSingle();
  if (profileError) throw new Error(`Could not load the profile: ${profileError.message}`);
  if (!profile) return;

  if (profile.activated_at !== null) {
    await sendEmail({ type: "account_already_active", recipient_email: email });
    return;
  }
  if (!ACTIVATABLE_ROLES.includes(profile.role)) return;
  if (!(await withinRateLimit(admin, email))) return;

  const code = activationCode();
  const { error: insertError } = await admin.from("activation_codes").insert({
    email,
    code_hash: await hashCode(email, code),
    expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
  });
  if (insertError) throw new Error(`Could not store the code: ${insertError.message}`);

  await sendEmail({ type: "account_activation", recipient_email: email, activation_code: code });
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
    await issueCode(admin, email);
    return json({ message: GENERIC_MESSAGE }, 200);
  } catch (error) {
    console.error("request-activation-code failed:", error instanceof Error ? error.message : error);
    return json({ message: GENERIC_MESSAGE }, 200);
  }
});
