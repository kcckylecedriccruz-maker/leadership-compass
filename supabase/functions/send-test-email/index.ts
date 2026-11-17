import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { hasModuleById } from "../_shared/access.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.57.4";
import { gmailSmtpAccount } from "../_shared/gmailSmtp.ts";

const EMAIL_KINDS = [
  "invite",
  "submitted_alert",
  "reminder",
  "submission_confirmation",
  "dashboard_ready",
  "cycle_closed",
  "temporary_password",
  "account_activation",
  "account_invite",
  "account_already_active",
  "talent_added",
  "test_email",
] as const;

type EmailKind = (typeof EMAIL_KINDS)[number];

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ALWAYS_ON: EmailKind[] = ["invite", "account_activation", "temporary_password"];

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

// NS10: the same preference logic as live sends, duplicated here because edge
// functions cannot share runtime code beyond static template definitions.
async function checkPreference(
  admin: SupabaseClient,
  emailType: EmailKind,
  recipientEmail: string,
  cycleId: string | null,
): Promise<"send" | string> {
  if (ALWAYS_ON.includes(emailType)) return "send";

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id")
    .eq("email", recipientEmail)
    .maybeSingle();
  if (profileError) throw new Error("Could not look up the recipient.");
  const profileId = (profile as { id: string } | null)?.id ?? null;
  if (!profileId) return "send";

  const { data: pref, error } = await admin
    .from("notification_preferences")
    .select("enabled, delivery")
    .eq("profile_id", profileId)
    .eq("email_type", emailType)
    .maybeSingle();
  if (error) throw new Error("Could not load notification preferences.");

  const row = pref as { enabled: boolean } | null;
  if (row && !row.enabled) return "Turned off in the recipient's notification settings.";

  if (emailType === "reminder" && cycleId && row) {
    const { data: cycle, error: cycleError } = await admin
      .from("cycles")
      .select("reminder_every_days")
      .eq("id", cycleId)
      .maybeSingle();
    if (cycleError) throw new Error("Could not load the cycle.");
    const interval = (cycle as { reminder_every_days: number } | null)?.reminder_every_days ?? 1;
    if (interval < 1) {
      return "Reminder interval is set by the cycle administrator.";
    }
  }
  return "send";
}

async function senderFrom(admin: SupabaseClient): Promise<string> {
  const { data } = await admin
    .from("app_settings")
    .select("sender_name, sender_email, sender_domain_status, email_provider, gmail_account, gmail_status, gmail_token_secret_id")
    .eq("id", 1)
    .maybeSingle();
  const row = data as {
    sender_name: string | null;
    sender_email: string | null;
    sender_domain_status: string;
    email_provider: string | null;
    gmail_account: string | null;
    gmail_status: string | null;
    gmail_token_secret_id: string | null;
  } | null;
  const name = row?.sender_name?.trim() || "Leadership Compass";
  // Matches send-email: Gmail sends as the connected account (SMTP first).
  const smtpAccount = gmailSmtpAccount();
  if (row?.email_provider !== "resend" && smtpAccount) return `${name} <${smtpAccount}>`;
  if (row?.email_provider !== "resend" && row?.gmail_token_secret_id && row.gmail_account && row.gmail_status !== "not_connected") {
    return `${name} <${row.gmail_account}>`;
  }
  if (row?.sender_email && row.sender_domain_status === "verified") {
    return `${name} <${row.sender_email}>`;
  }
  const fromEmail = Deno.env.get("FROM_EMAIL") ?? row?.sender_email ?? "Leadership Compass";
  return fromEmail.includes("<") ? fromEmail : `Leadership Compass <${fromEmail}>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

    const authHeader = req.headers.get("Authorization") ?? "";
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData?.user) return json({ error: "Sign in to send a test email." }, 401);

    const { data: callerProfile, error: callerError } = await supabase
      .from("profiles")
      .select("role, email")
      .eq("id", userData.user.id)
      .maybeSingle();
    if (callerError) return json({ error: "Could not load your profile." }, 500);
    if (!callerProfile) return json({ error: "Profile not found." }, 404);
    if (!(await hasModuleById(userData.user.id, "settings", "edit"))) {
      return json({ error: "You need edit access to Settings to send a test email." }, 403);
    }

    const body = (await req.json().catch(() => null)) as {
      recipient_email?: unknown;
      email_type?: unknown;
      assignment_id?: unknown;
      cycle_id?: unknown;
    } | null;

    const recipientEmail = typeof body?.recipient_email === "string" ? body.recipient_email.trim().toLowerCase() : "";
    if (!recipientEmail || !EMAIL_PATTERN.test(recipientEmail) || recipientEmail.length > 254) {
      return json({ error: "recipient_email must be a valid email address." }, 400);
    }

    const emailType = typeof body?.email_type === "string" ? (body.email_type.trim() as EmailKind) : "test_email";
    if (!(EMAIL_KINDS as readonly string[]).includes(emailType)) {
      return json({ error: "email_type must be one of the supported email types." }, 400);
    }

    const assignmentId = typeof body?.assignment_id === "string" && UUID_PATTERN.test(body.assignment_id) ? body.assignment_id : null;
    const cycleId = typeof body?.cycle_id === "string" && UUID_PATTERN.test(body.cycle_id) ? body.cycle_id : null;

    const internalSecret = Deno.env.get("INTERNAL_SECRET");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    if (!internalSecret || !supabaseUrl) return json({ error: "The email service is not configured yet." }, 500);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const from = await senderFrom(admin);
    let checkResult = "send";
    try {
      checkResult = await checkPreference(admin, emailType, recipientEmail, cycleId);
    } catch (prefError) {
      return json({ error: prefError instanceof Error ? prefError.message : "Could not check preferences." }, 500);
    }

    if (checkResult !== "send") {
      await admin.from("notifications").insert({
        type: emailType,
        recipient_email: recipientEmail,
        cycle_id: cycleId,
        assignment_id: assignmentId,
        status: "skipped_by_preference",
        error: checkResult,
        is_test: true,
      });
      return json({ status: "skipped", reason: checkResult }, 200);
    }

    const response = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-secret": internalSecret },
      body: JSON.stringify({
        type: "test_email",
        recipient_email: recipientEmail,
        tested_type: emailType,
        check_result: `Preference check passed for "${emailType}". This is what the recipient would receive.`,
        sender_from: from,
      }),
    });
    const result = (await response.json().catch(() => null)) as { status?: string; error?: string } | null;
    if (!response.ok) {
      await admin.from("notifications").insert({
        type: emailType,
        recipient_email: recipientEmail,
        cycle_id: cycleId,
        assignment_id: assignmentId,
        status: "failed",
        error: (result?.error ?? "The test email could not be sent.").slice(0, 1000),
        is_test: true,
      });
      return json({ status: "failed", error: result?.error ?? "The test email could not be sent." }, 200);
    }

    return json({ status: "sent", sender: from }, 200);
  } catch (error) {
    console.error("send-test-email failed:", error instanceof Error ? error.message : error);
    return json({ error: "Unexpected error while sending the test email." }, 500);
  }
});
