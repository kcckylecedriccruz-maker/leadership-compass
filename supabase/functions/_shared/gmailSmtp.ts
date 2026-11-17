// Gmail SMTP transport (smtp.gmail.com:465, implicit TLS) using a Google
// "App password". Simpler than the OAuth Gmail API connection: set two edge
// function secrets and email works. Supabase blocks outbound ports 25 and 587,
// so this always uses 465.
//
// Secrets (Supabase > Edge Functions > Secrets):
//   GMAIL_SMTP_USER          the Gmail / Google Workspace address that sends
//   GMAIL_SMTP_APP_PASSWORD  16-character app password from
//                            myaccount.google.com > Security > App passwords

import nodemailer from "npm:nodemailer@6.9.16";

export type SmtpCredentials = { user: string; pass: string };

export function gmailSmtpCredentials(): SmtpCredentials | null {
  const clean = (value: string | undefined) => (value ?? "").trim().replace(/^["']|["']$/g, "");
  const user = clean(Deno.env.get("GMAIL_SMTP_USER"));
  // App passwords are shown with spaces ("abcd efgh ijkl mnop"); Google accepts them without.
  const pass = clean(Deno.env.get("GMAIL_SMTP_APP_PASSWORD")).replace(/\s+/g, "");
  if (!user || !pass) return null;
  return { user, pass };
}

/** The address emails come from when Gmail SMTP is configured, else null. */
export function gmailSmtpAccount(): string | null {
  return gmailSmtpCredentials()?.user ?? null;
}

let transporter: ReturnType<typeof nodemailer.createTransport> | null = null;
let transporterUser: string | null = null;

function getTransporter(credentials: SmtpCredentials) {
  if (transporter && transporterUser === credentials.user) return transporter;
  transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: credentials.user, pass: credentials.pass },
  });
  transporterUser = credentials.user;
  return transporter;
}

export type SmtpSendInput = {
  fromName: string | null;
  to: string;
  replyTo: string | null;
  subject: string;
  html: string;
  text: string;
};

export type SmtpSendResult =
  | { ok: true }
  | { ok: false; kind: "reconnect_needed" | "rate_limited" | "failed"; error: string };

export async function sendViaGmailSmtp(credentials: SmtpCredentials, input: SmtpSendInput): Promise<SmtpSendResult> {
  try {
    await getTransporter(credentials).sendMail({
      // Gmail SMTP always sends as the authenticated account.
      from: input.fromName ? { name: input.fromName, address: credentials.user } : credentials.user,
      to: input.to,
      replyTo: input.replyTo ?? undefined,
      subject: input.subject,
      html: input.html,
      text: input.text,
    });
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const responseCode = (error as { responseCode?: number }).responseCode;
    if (responseCode === 535 || /auth|username and password/i.test(message)) {
      return {
        ok: false,
        kind: "reconnect_needed",
        error: `Gmail SMTP sign-in failed. Check GMAIL_SMTP_USER and GMAIL_SMTP_APP_PASSWORD (use an App password, not the account password). ${message}`.slice(0, 500),
      };
    }
    if (responseCode === 550 && /limit|quota/i.test(message)) {
      return { ok: false, kind: "rate_limited", error: `Gmail daily sending limit reached: ${message}`.slice(0, 500) };
    }
    if (responseCode === 421 || responseCode === 454) {
      return { ok: false, kind: "rate_limited", error: `Gmail SMTP is throttling: ${message}`.slice(0, 500) };
    }
    return { ok: false, kind: "failed", error: `Gmail SMTP error: ${message}`.slice(0, 500) };
  }
}
