import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE_PATTERN = /^[0-9]{6}$/;
// Every role activates the same way, admins included (admins are created from User control).
const ACTIVATABLE_ROLES = ["admin", "assessor", "talent", "manager"];
const MAX_ATTEMPTS = 5;
const MIN_PASSWORD_LENGTH = 12;
const INVALID_CODE_MESSAGE = "That code is not right. Check the email and try again.";
const EXPIRED_CODE_MESSAGE = "That code has expired or was cancelled. Request a new code.";

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function hashCode(email: string, code: string): Promise<string> {
  const data = new TextEncoder().encode(`${email}:${code}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

type Outcome = { status: number; body: Record<string, unknown> };

async function checkCode(admin: SupabaseClient, email: string, code: string): Promise<Outcome | null> {
  const { data: latest, error } = await admin
    .from("activation_codes")
    .select("id, code_hash, expires_at, attempts")
    .eq("email", email)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Could not load the code: ${error.message}`);
  if (!latest || Date.parse(latest.expires_at) <= Date.now() || latest.attempts >= MAX_ATTEMPTS) {
    return { status: 400, body: { error: EXPIRED_CODE_MESSAGE } };
  }

  if ((await hashCode(email, code)) === latest.code_hash) return null;

  const attempts = latest.attempts + 1;
  if (attempts >= MAX_ATTEMPTS) {
    const { error: cancelError } = await admin.from("activation_codes").delete().eq("email", email);
    if (cancelError) throw new Error(`Could not cancel the code: ${cancelError.message}`);
    return { status: 400, body: { error: "Too many wrong attempts. Request a new code." } };
  }
  const { error: attemptError } = await admin.from("activation_codes").update({ attempts }).eq("id", latest.id);
  if (attemptError) throw new Error(`Could not record the attempt: ${attemptError.message}`);
  return { status: 400, body: { error: INVALID_CODE_MESSAGE } };
}

async function activate(admin: SupabaseClient, email: string, password: string): Promise<Outcome> {
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id, role, activated_at")
    .eq("email", email)
    .maybeSingle();
  if (profileError) throw new Error(`Could not load the profile: ${profileError.message}`);
  if (!profile || profile.activated_at !== null || !ACTIVATABLE_ROLES.includes(profile.role)) {
    return { status: 400, body: { error: EXPIRED_CODE_MESSAGE } };
  }

  const { error: passwordError } = await admin.auth.admin.updateUserById(profile.id, { password });
  if (passwordError) throw new Error(`Could not set the password: ${passwordError.message}`);

  const { error: updateError } = await admin
    .from("profiles")
    .update({ activated_at: new Date().toISOString(), must_change_password: false, temp_password_expires_at: null })
    .eq("id", profile.id);
  if (updateError) throw new Error(`Could not activate the profile: ${updateError.message}`);

  const { error: auditError } = await admin.from("audit_log").insert({
    actor_id: profile.id,
    action: "profile.activated",
    entity: "profile",
    entity_id: profile.id,
    details: { method: "activation_code" },
  });
  if (auditError) throw new Error(`Could not write the audit entry: ${auditError.message}`);

  const { error: cleanupError } = await admin.from("activation_codes").delete().eq("email", email);
  if (cleanupError) throw new Error(`Could not clear codes: ${cleanupError.message}`);

  return { status: 200, body: { email, message: "Your account is ready." } };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

    const body = await req.json().catch(() => null);
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const code = typeof body?.code === "string" ? body.code.trim() : "";
    const password = typeof body?.password === "string" ? body.password : "";

    if (!EMAIL_PATTERN.test(email) || email.length > 254) {
      return json({ error: "Enter a valid work email address." }, 400);
    }
    if (!CODE_PATTERN.test(code)) return json({ error: "Enter the 6-digit code." }, 400);
    if (password.length < MIN_PASSWORD_LENGTH || password.length > 200) {
      return json({ error: `Your password must be at least ${MIN_PASSWORD_LENGTH} characters.` }, 400);
    }
    if (password.toLowerCase() === email) {
      return json({ error: "Your password cannot be your email address." }, 400);
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    const failed = await checkCode(admin, email, code);
    if (failed) return json(failed.body, failed.status);

    const outcome = await activate(admin, email, password);
    return json(outcome.body, outcome.status);
  } catch (error) {
    console.error("activate-account failed:", error instanceof Error ? error.message : error);
    return json({ error: "Something went wrong while creating your account. Please try again." }, 500);
  }
});
