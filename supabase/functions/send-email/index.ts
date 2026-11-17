import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.57.4";
import {
  EMAIL_KINDS,
  applyTemplateOverride,
  buildPreferenceLinks,
  renderEmail,
  toHtml,
  toText,
  unsubscribeTokenFor,
} from "./templates.ts";
import type { EmailKind } from "./templates.ts";
import { prepareEmail } from "./context.ts";
import type { EmailRequest } from "./context.ts";
import { sendViaGmail } from "../_shared/gmailMail.ts";
import { gmailSmtpAccount } from "../_shared/gmailSmtp.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const RESEND_URL = "https://api.resend.com/emails";
const APP_TITLE = "Leadership Compass";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NEEDS_ASSIGNMENT: EmailKind[] = ["invite", "submitted_alert", "reminder", "submission_confirmation"];

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Resend and FROM_EMAIL are optional: a Gmail-only setup needs neither.
type Config = { apiKey: string | null; fromAddress: string | null; appUrl: string; internalSecret: string };

type SenderSettings = {
  from: string;
  fromAddress: string;
  fromName: string;
  replyTo: string | null;
  usedFallback: boolean;
  provider: "gmail" | "resend";
  gmailReady: boolean;
};

type AppSettingsRow = {
  sender_name: string | null;
  sender_email: string | null;
  reply_to_email: string | null;
  sender_domain_status: string;
  email_provider: "gmail" | "resend" | null;
  gmail_account: string | null;
  gmail_status: string | null;
  gmail_token_secret_id: string | null;
};

// NS14 + NS18: pick the sender for this send.
// - Gmail: sends only as the connected account, so that account is the From
//   address (Gmail would rewrite any other address anyway). No Resend domain
//   check applies.
// - Resend: the saved sender needs a verified domain; otherwise FROM_EMAIL.
async function loadSenderSettings(admin: SupabaseClient, config: Config): Promise<SenderSettings> {
  const { data, error } = await admin
    .from("app_settings")
    .select("sender_name, sender_email, reply_to_email, sender_domain_status, email_provider, gmail_account, gmail_status, gmail_token_secret_id")
    .eq("id", 1)
    .maybeSingle();
  if (error) throw new Error(`Could not load the sender settings: ${error.message}`);

  const row = data as AppSettingsRow | null;
  const provider = row?.email_provider === "resend" ? "resend" : "gmail";
  const name = row?.sender_name?.trim() || APP_TITLE;
  const replyTo = row?.reply_to_email ?? null;
  // Gmail SMTP (app password secrets) counts as a ready Gmail transport.
  const smtpAccount = gmailSmtpAccount();
  const gmailAccount = smtpAccount ?? row?.gmail_account ?? null;
  const gmailReady = Boolean(smtpAccount) || Boolean(row?.gmail_token_secret_id && row?.gmail_account && row?.gmail_status !== "not_connected");

  if (provider === "gmail" && gmailReady && gmailAccount) {
    return {
      from: `${name} <${gmailAccount}>`,
      fromAddress: gmailAccount,
      fromName: name,
      replyTo,
      usedFallback: false,
      provider,
      gmailReady,
    };
  }

  if (provider === "resend" && row?.sender_email && row.sender_domain_status === "verified") {
    return {
      from: `${name} <${row.sender_email}>`,
      fromAddress: row.sender_email,
      fromName: name,
      replyTo,
      usedFallback: false,
      provider,
      gmailReady,
    };
  }

  const fallbackAddress = config.fromAddress ?? row?.sender_email ?? "";
  const sender: SenderSettings = {
    from: `${APP_TITLE} <${fallbackAddress}>`,
    fromAddress: fallbackAddress,
    fromName: APP_TITLE,
    replyTo,
    usedFallback: true,
    provider,
    gmailReady,
  };
  if (!(await hasFallbackNotice(admin))) {
    await notifyAdmins(admin, config, sender, "sender_fallback_notice", {
      subject: "Action needed: emails are using the default sender",
      text:
        provider === "gmail"
          ? "Gmail is not connected, so emails are going out through the backup sender (if one is set up). Open Sender settings in Leadership Compass and connect Gmail."
          : "Emails are being sent from the default address because no verified sender is saved in the sender settings. Save a verified sender on the sender settings page to fix this.",
    });
  }
  return sender;
}

async function hasFallbackNotice(admin: SupabaseClient): Promise<boolean> {
  return hasNoticeSince(admin, "sender_fallback_notice", FALLBACK_NOTICE_WINDOW_MS * 365);
}

const FALLBACK_NOTICE_WINDOW_MS = 24 * 60 * 60 * 1000;

async function hasNoticeSince(admin: SupabaseClient, noticeType: string, sinceMs: number): Promise<boolean> {
  const { data, error } = await admin
    .from("notifications")
    .select("id")
    .eq("type", noticeType)
    .gte("created_at", new Date(Date.now() - sinceMs).toISOString())
    .limit(1);
  if (error) return false;
  return (data ?? []).length > 0;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
}

// Admin notices go through whichever transport works: Gmail when connected,
// otherwise Resend when configured. Logged so each notice is sent once.
async function notifyAdmins(
  admin: SupabaseClient,
  config: Config,
  sender: SenderSettings,
  noticeType: string,
  notice: { subject: string; text: string },
): Promise<void> {
  try {
    const { data: admins, error } = await admin.from("profiles").select("email").eq("role", "admin");
    if (error || !admins || admins.length === 0) return;
    const recipient = (admins as { email: string }[])[0].email;
    const html = `<p>${escapeHtml(notice.text)}</p>`;
    let provider: "gmail" | "resend" | null = null;

    if (sender.gmailReady) {
      const { data: row } = await admin.from("app_settings").select("gmail_account").eq("id", 1).maybeSingle();
      const account = (row as { gmail_account: string | null } | null)?.gmail_account;
      if (account) {
        const result = await sendViaGmail(admin, {
          fromName: APP_TITLE,
          from: account,
          replyTo: null,
          to: recipient,
          subject: notice.subject,
          html,
          text: notice.text,
        });
        if (result.ok) provider = "gmail";
      }
    }
    if (!provider && config.apiKey && config.fromAddress) {
      const response = await fetch(RESEND_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: `${APP_TITLE} <${config.fromAddress}>`,
          to: [recipient],
          subject: notice.subject,
          html,
          text: notice.text,
        }),
      });
      if (response.ok) provider = "resend";
    }
    if (provider) {
      await admin.from("notifications").insert({
        type: noticeType,
        recipient_email: recipient,
        status: "sent",
        sent_at: new Date().toISOString(),
        provider,
      });
    } else {
      console.error(`Admin notice ${noticeType} could not be delivered: no working transport.`);
    }
  } catch (notifyError) {
    console.error(`Could not send admin notice ${noticeType}:`, notifyError);
  }
}

// NS21: one alert per 24h while the fallback is in use.
async function notifyAdminsFallbackUsed(admin: SupabaseClient, config: Config, sender: SenderSettings, gmailError: string): Promise<void> {
  if (await hasNoticeSince(admin, "gmail_fallback_notice", FALLBACK_NOTICE_WINDOW_MS)) return;
  await notifyAdmins(admin, config, { ...sender, gmailReady: false }, "gmail_fallback_notice", {
    subject: "Emails are being sent via the fallback provider",
    text: `Gmail could not send an email, so it went out via the fallback provider instead. Error: ${gmailError} Check the connection on the sender settings page.`,
  });
}

// NS21: Gmail allows 2,000 sends/day (Workspace); email admins once per rolling 24h at 1,600.
const GMAIL_DAILY_LIMIT = 2000;
const GMAIL_DAILY_WARN = 1600;

async function notifyAdminsGmailQuota(admin: SupabaseClient, config: Config, sender: SenderSettings, sentCount: number): Promise<void> {
  if (await hasNoticeSince(admin, "gmail_daily_limit_notice", FALLBACK_NOTICE_WINDOW_MS)) return;
  await notifyAdmins(admin, config, sender, "gmail_daily_limit_notice", {
    subject: "Gmail daily sending limit is nearly reached",
    text: `${sentCount} emails were sent via Gmail in the last 24 hours. Gmail allows about ${GMAIL_DAILY_LIMIT} per day for Workspace accounts (fewer for personal Gmail), so sends will start falling back to the other provider soon.`,
  });
}

async function checkGmailDailyQuota(admin: SupabaseClient, config: Config, sender: SenderSettings): Promise<void> {
  const { count, error } = await admin
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("provider", "gmail")
    .eq("status", "sent")
    .eq("is_test", false)
    .gte("created_at", new Date(Date.now() - FALLBACK_NOTICE_WINDOW_MS).toISOString());
  if (error || count === null) return;
  if (count >= GMAIL_DAILY_WARN) {
    await notifyAdminsGmailQuota(admin, config, sender, count);
  }
}

const ALWAYS_ON: EmailKind[] = ["invite", "account_activation", "temporary_password"];
const REMINDER_INTERVAL_FLOOR_DAYS = 1;

async function profileIdForEmail(admin: SupabaseClient, email: string): Promise<string | null> {
  const { data, error } = await admin.from("profiles").select("id").eq("email", email).maybeSingle();
  if (error) throw new Error(`Could not look up the recipient: ${error.message}`);
  return (data as { id: string } | null)?.id ?? null;
}

// NS5: cycle settings are the defaults; a user choice may only narrow them.
async function checkPreference(
  admin: SupabaseClient,
  request: EmailRequest,
  cycleId: string | null,
): Promise<"send" | string> {
  if (ALWAYS_ON.includes(request.kind)) return "send";

  const profileId = await profileIdForEmail(admin, request.recipientEmail);
  if (!profileId) return "send";

  const { data: pref, error } = await admin
    .from("notification_preferences")
    .select("enabled, delivery")
    .eq("profile_id", profileId)
    .eq("email_type", request.kind)
    .maybeSingle();
  if (error) throw new Error(`Could not load notification preferences: ${error.message}`);

  const row = pref as { enabled: boolean; delivery: string } | null;
  if (row && !row.enabled) return "Turned off in the recipient's notification settings.";

  if (request.kind === "reminder" && cycleId && row) {
    const { data: cycle, error: cycleError } = await admin
      .from("cycles")
      .select("reminder_every_days")
      .eq("id", cycleId)
      .maybeSingle();
    if (cycleError) throw new Error(`Could not load the cycle: ${cycleError.message}`);
    const interval = (cycle as { reminder_every_days: number } | null)?.reminder_every_days ?? REMINDER_INTERVAL_FLOOR_DAYS;
    if (REMINDER_INTERVAL_FLOOR_DAYS > interval) {
      return "Reminder interval is set by the cycle administrator.";
    }
  }
  return "send";
}

async function wantsDigest(admin: SupabaseClient, email: string): Promise<boolean> {
  const profileId = await profileIdForEmail(admin, email);
  if (!profileId) return false;
  const { data, error } = await admin
    .from("notification_preferences")
    .select("delivery")
    .eq("profile_id", profileId)
    .eq("email_type", "submitted_alert")
    .maybeSingle();
  if (error) throw new Error(`Could not load notification preferences: ${error.message}`);
  return (data as { delivery: string } | null)?.delivery === "daily_digest";
}

async function queueDigest(
  admin: SupabaseClient,
  request: EmailRequest,
  cycleId: string | null,
  assignmentId: string | null,
): Promise<boolean> {
  const profileId = await profileIdForEmail(admin, request.recipientEmail);
  if (!profileId || !cycleId) return false;
  const { error } = await admin.from("notification_digest_queue").insert({
    profile_id: profileId,
    email_type: request.kind,
    cycle_id: cycleId,
    assignment_id: assignmentId,
  });
  if (error) throw new Error(`Could not queue the digest entry: ${error.message}`);
  return true;
}

function readConfig(): Config | null {
  const apiKey = Deno.env.get("RESEND_API_KEY")?.trim() || null;
  const fromEmail = Deno.env.get("FROM_EMAIL")?.trim() || null;
  const appUrl = Deno.env.get("APP_URL")?.trim();
  const internalSecret = Deno.env.get("INTERNAL_SECRET");
  if (!appUrl || !internalSecret) return null;
  const fromAddress = fromEmail ? fromEmail.match(/<([^>]+)>/)?.[1].trim() ?? fromEmail : null;
  return { apiKey, fromAddress, appUrl: appUrl.replace(/\/+$/, ""), internalSecret };
}

function safeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left[i] ^ right[i];
  return diff === 0;
}

function rawIsTest(request: EmailRequest): boolean {
  return request.isTest === true || request.kind === "test_email";
}

type ParseResult = { ok: true; value: EmailRequest } | { ok: false; error: string };

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function parsePayload(body: unknown): ParseResult {
  if (typeof body !== "object" || body === null) return { ok: false, error: "The request body must be a JSON object." };
  const raw = body as Record<string, unknown>;

  const kind = raw.type;
  if (typeof kind !== "string" || !(EMAIL_KINDS as readonly string[]).includes(kind)) {
    return { ok: false, error: `type must be one of: ${EMAIL_KINDS.join(", ")}.` };
  }
  const emailKind = kind as EmailKind;

  const recipientEmail = optionalString(raw.recipient_email)?.toLowerCase() ?? null;
  if (!recipientEmail || !EMAIL_PATTERN.test(recipientEmail) || recipientEmail.length > 254) {
    return { ok: false, error: "recipient_email must be a valid email address." };
  }

  const assignmentId = optionalString(raw.assignment_id);
  const cycleId = optionalString(raw.cycle_id);
  const talentId = optionalString(raw.talent_id);
  for (const [name, id] of [
    ["assignment_id", assignmentId],
    ["cycle_id", cycleId],
    ["talent_id", talentId],
  ] as const) {
    if (id !== null && !UUID_PATTERN.test(id)) return { ok: false, error: `${name} must be a valid id.` };
  }
  if (NEEDS_ASSIGNMENT.includes(emailKind) && !assignmentId) {
    return { ok: false, error: `assignment_id is required for ${emailKind} emails.` };
  }
  if (emailKind === "dashboard_ready" && (!cycleId || !talentId)) {
    return { ok: false, error: "cycle_id and talent_id are required for dashboard_ready emails." };
  }
  if (emailKind === "cycle_closed" && !cycleId) {
    return { ok: false, error: "cycle_id is required for cycle_closed emails." };
  }

  if (emailKind === "test_email") {
    const testedType = optionalString(raw.tested_type);
    if (!testedType || !(EMAIL_KINDS as readonly string[]).includes(testedType)) {
      return { ok: false, error: "tested_type must be one of the supported email types." };
    }
    return {
      ok: true,
      value: {
        kind: emailKind,
        recipientEmail,
        assignmentId: null,
        cycleId: null,
        talentId: null,
        temporaryPassword: null,
        activationCode: null,
        isTest: true,
        testedType,
        checkResult: optionalString(raw.check_result),
        senderFrom: optionalString(raw.sender_from),
      },
    };
  }

  const temporaryPassword = optionalString(raw.temporary_password);
  if (temporaryPassword && temporaryPassword.length > 200) {
    return { ok: false, error: "temporary_password is too long." };
  }
  if (emailKind === "temporary_password" && !temporaryPassword) {
    return { ok: false, error: "temporary_password is required for temporary_password emails." };
  }

  const activationCode = optionalString(raw.activation_code);
  if (activationCode && !/^[0-9]{6}$/.test(activationCode)) {
    return { ok: false, error: "activation_code must be 6 digits." };
  }
  if (emailKind === "account_activation" && !activationCode) {
    return { ok: false, error: "activation_code is required for account_activation emails." };
  }

  return {
    ok: true,
    value: {
      kind: emailKind,
      recipientEmail,
      assignmentId,
      cycleId,
      talentId,
      temporaryPassword,
      activationCode,
    },
  };
}

async function sendWithResend(
  config: Config,
  sender: SenderSettings,
  message: { to: string; subject: string; html: string; text: string },
): Promise<void> {
  if (!config.apiKey) throw new Error("Resend is not configured (RESEND_API_KEY is not set).");
  const resendFrom = sender.provider === "resend" && !sender.usedFallback
    ? sender.from
    : config.fromAddress
    ? `${sender.fromName} <${config.fromAddress}>`
    : null;
  if (!resendFrom) throw new Error("Resend fallback needs FROM_EMAIL on a domain verified in Resend.");
  const payload: Record<string, unknown> = {
    from: resendFrom,
    to: [message.to],
    subject: message.subject,
    html: message.html,
    text: message.text,
  };
  if (sender.replyTo) payload.reply_to = sender.replyTo;
  const response = await fetch(RESEND_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(`Resend responded with ${response.status}: ${detail}`);
  }
}

// NS18/NS21: Gmail first (one retry via the helper), then Resend via FROM_EMAIL.
// Each email goes to exactly one recipient per Gmail call.
async function sendWithFallback(
  config: Config,
  sender: SenderSettings,
  admin: SupabaseClient,
  message: { to: string; subject: string; html: string; text: string },
): Promise<{ provider: "gmail" | "resend"; attempts: number; error: string | null }> {
  if (sender.provider === "gmail" && sender.gmailReady) {
    const result = await sendViaGmail(admin, {
      fromName: sender.fromName,
      from: sender.fromAddress,
      replyTo: sender.replyTo,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });
    if (result.ok) return { provider: "gmail", attempts: 1, error: null };
    if (result.kind === "reconnect_needed") {
      // Gmail is down for approval reasons; still try the fallback once.
      try {
        await sendWithResend(config, sender, message);
        await notifyAdminsFallbackUsed(admin, config, sender, result.error);
        return { provider: "resend", attempts: 2, error: `gmail failed: ${result.error}` };
      } catch (resendError) {
        throw new Error(
          `gmail: ${result.error}; resend: ${resendError instanceof Error ? resendError.message : String(resendError)}`,
        );
      }
    }
    if (result.kind === "rate_limited") {
      try {
        await sendWithResend(config, sender, message);
        await notifyAdminsGmailQuota(admin, config, sender, GMAIL_DAILY_WARN);
        return { provider: "resend", attempts: 2, error: `gmail failed: ${result.error}` };
      } catch (resendError) {
        throw new Error(
          `gmail: ${result.error}; resend: ${resendError instanceof Error ? resendError.message : String(resendError)}`,
        );
      }
    }
    // Transient failure: one immediate resend through the fallback.
    try {
      await sendWithResend(config, sender, message);
      await notifyAdminsFallbackUsed(admin, config, sender, result.error);
      return { provider: "resend", attempts: 2, error: `gmail failed: ${result.error}` };
    } catch (resendError) {
      throw new Error(
        `gmail: ${result.error}; resend: ${resendError instanceof Error ? resendError.message : String(resendError)}`,
      );
    }
  }
  await sendWithResend(config, sender, message);
  return { provider: "resend", attempts: 1, error: null };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

    const config = readConfig();
    if (!config) {
      return json({ error: "The email service is not configured yet: set APP_URL and INTERNAL_SECRET in Supabase secrets." }, 500);
    }

    const provided = req.headers.get("x-internal-secret") ?? "";
    if (!safeEqual(provided, config.internalSecret)) {
      return json({ error: "Unauthorized." }, 401);
    }

    const parsed = parsePayload(await req.json().catch(() => null));
    if (!parsed.ok) return json({ error: parsed.error }, 400);
    const request = parsed.value;
    const isTest = rawIsTest(request);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    const sender = await loadSenderSettings(admin, config);

    const prepared = await prepareEmail(admin, config.appUrl, request);
    if (prepared.outcome === "rejected") return json({ error: prepared.message }, prepared.status);
    if (prepared.outcome === "skipped") return json({ status: "skipped", reason: prepared.reason }, 200);

    const preference = await checkPreference(admin, request, prepared.cycleId ?? null);
    if (preference !== "send") {
      const { error: skipError } = await admin.from("notifications").insert({
        type: request.kind,
        recipient_email: request.recipientEmail,
        assignment_id: prepared.assignmentId,
        cycle_id: prepared.cycleId ?? null,
        status: "skipped_by_preference",
        error: preference,
        is_test: isTest,
      });
      if (skipError) throw new Error(`Could not log skipped send: ${skipError.message}`);
      return json({ status: "skipped", reason: preference }, 200);
    }

    if (
      !isTest &&
      request.kind === "submitted_alert" &&
      prepared.cycleId &&
      (await wantsDigest(admin, request.recipientEmail))
    ) {
      await queueDigest(admin, request, prepared.cycleId, prepared.assignmentId);
      return json({ status: "queued" }, 200);
    }

    const rendered = renderEmail(prepared.data);
    await applyTemplateOverride(rendered, prepared.data, admin);
    const profileId = await profileIdForEmail(admin, request.recipientEmail);
    const unsubscribeToken = profileId ? await unsubscribeTokenFor(profileId, request.kind, config.internalSecret) : null;
    rendered.preferenceLinks = buildPreferenceLinks(request.kind, config.appUrl, profileId, unsubscribeToken);
    const senderName = sender.from.replace(/\s*<.*>$/, "");
    const html = toHtml(rendered, senderName);
    const text = toText(rendered, senderName);

    const logBase = {
      type: request.kind,
      recipient_email: request.recipientEmail,
      assignment_id: prepared.assignmentId,
      cycle_id: prepared.cycleId,
      is_test: isTest,
    };

    if (sender.provider === "gmail" && sender.gmailReady && !isTest) {
      await checkGmailDailyQuota(admin, config, sender);
    }

    try {
      const outcome = await sendWithFallback(config, sender, admin, {
        to: request.recipientEmail,
        subject: rendered.subject,
        html,
        text,
      });
      const sentAt = new Date().toISOString();
      const { error: logError } = await admin.from("notifications").insert({
        ...logBase,
        status: "sent",
        sent_at: sentAt,
        provider: outcome.provider,
        attempts: outcome.attempts,
        error: outcome.error ? outcome.error.slice(0, 1000) : null,
      });
      if (logError) throw new Error(`Email was sent but could not be logged: ${logError.message}`);

      if (request.kind === "reminder" && prepared.assignmentId && !isTest) {
        const { error: reminderError } = await admin
          .from("assignments")
          .update({ last_reminded_at: sentAt })
          .eq("id", prepared.assignmentId);
        if (reminderError) throw new Error(`Could not record the reminder: ${reminderError.message}`);
      }

      return json({ status: "sent", provider: outcome.provider }, 200);
    } catch (sendError) {
      const message = sendError instanceof Error ? sendError.message : String(sendError);
      const { error: logError } = await admin
        .from("notifications")
        .insert({ ...logBase, status: "failed", error: message.slice(0, 1000), attempts: 2 });
      if (logError) throw new Error(`Could not log failed send: ${logError.message}`);
      console.error(`Email ${request.kind} failed: ${message}`);
      return json({ error: "The email could not be sent." }, 502);
    }
  } catch (error) {
    console.error("send-email failed:", error instanceof Error ? error.message : error);
    return json({ error: "Unexpected error while sending the email." }, 500);
  }
});
