// NS18-NS22: Gmail API transport, shared by the email edge functions.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2.57.4";
import { gmailSmtpCredentials, sendViaGmailSmtp } from "./gmailSmtp.ts";

export type GmailSendInput = {
  fromName: string | null;
  from: string;
  replyTo: string | null;
  to: string;
  subject: string;
  html: string;
  text: string;
};

export type GmailSendResult =
  | { ok: true }
  | { ok: false; kind: "reconnect_needed" | "rate_limited" | "failed"; error: string };

type CachedToken = { token: string; expiresAt: number };

let cachedToken: CachedToken | null = null;

export async function saveGmailStatus(
  admin: SupabaseClient,
  status: "connected" | "reconnect_needed" | "failed" | "not_connected",
  errorText: string | null,
): Promise<void> {
  await admin
    .from("app_settings")
    .upsert({
      id: 1,
      gmail_status: status,
      gmail_status_error: errorText ? errorText.slice(0, 500) : null,
    });
}

// The refresh token lives only in Vault. These helpers go through the
// service-role-only SQL functions gmail_token_store/read/delete (migration
// 20261117090000) because the vault schema is not exposed to the Data API.
async function currentSecretId(admin: SupabaseClient): Promise<string | null> {
  const { data, error } = await admin
    .from("app_settings")
    .select("gmail_token_secret_id")
    .eq("id", 1)
    .maybeSingle();
  if (error || !data) return null;
  return (data as { gmail_token_secret_id: string | null }).gmail_token_secret_id ?? null;
}

async function readRefreshToken(admin: SupabaseClient): Promise<string | null> {
  const secretId = await currentSecretId(admin);
  if (!secretId) return null;
  const { data, error } = await admin.rpc("gmail_token_read", { p_secret_id: secretId });
  if (error) {
    console.error("Could not read the Gmail token from Vault:", error.message);
    return null;
  }
  return typeof data === "string" && data.length > 0 ? data : null;
}

export async function storeRefreshToken(admin: SupabaseClient, refreshToken: string): Promise<string | null> {
  const { data, error } = await admin.rpc("gmail_token_store", { p_token: refreshToken });
  if (error || typeof data !== "string") {
    console.error("Could not store the Gmail token in Vault:", error?.message ?? "no id returned");
    return null;
  }
  cachedToken = null;
  return data;
}

export async function deleteRefreshToken(admin: SupabaseClient): Promise<void> {
  const secretId = await currentSecretId(admin);
  if (secretId) {
    const { error } = await admin.rpc("gmail_token_delete", { p_secret_id: secretId });
    if (error) console.error("Could not delete the Gmail token from Vault:", error.message);
  }
  cachedToken = null;
}

export type GoogleCredentials = { clientId: string; clientSecret: string };

// Catches the most common setup mistakes (a password, the secret in the ID
// field, stray spaces or quotes) with a message that says what to fix.
export function readGoogleCredentials(options: { needSecret: boolean }):
  | { ok: true; value: GoogleCredentials }
  | { ok: false; error: string } {
  const clean = (value: string | undefined) => (value ?? "").trim().replace(/^["']|["']$/g, "");
  const clientId = clean(Deno.env.get("GOOGLE_CLIENT_ID"));
  const clientSecret = clean(Deno.env.get("GOOGLE_CLIENT_SECRET"));
  if (!clientId) {
    return { ok: false, error: "GOOGLE_CLIENT_ID is not set. Add it in Supabase > Edge Functions > Secrets." };
  }
  if (clientId.startsWith("GOCSPX-")) {
    return { ok: false, error: "GOOGLE_CLIENT_ID holds the client secret. Swap GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Supabase." };
  }
  if (!/^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/i.test(clientId)) {
    return {
      ok: false,
      error:
        "GOOGLE_CLIENT_ID is not a Google OAuth client ID. Copy the Client ID ending in .apps.googleusercontent.com from Google Cloud > Google Auth Platform > Clients.",
    };
  }
  if (options.needSecret && !clientSecret) {
    return { ok: false, error: "GOOGLE_CLIENT_SECRET is not set. Add it in Supabase > Edge Functions > Secrets." };
  }
  return { ok: true, value: { clientId, clientSecret } };
}

export async function getAccessToken(admin: SupabaseClient): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.token;

  const credentials = readGoogleCredentials({ needSecret: true });
  if (!credentials.ok) throw new Error(credentials.error);
  const { clientId, clientSecret } = credentials.value;

  const refreshToken = await readRefreshToken(admin);
  if (!refreshToken) throw Object.assign(new Error("No Gmail account is connected."), { code: "not_connected" });

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  const body = (await response.json().catch(() => null)) as { access_token?: string; expires_in?: number; error?: string } | null;
  if (!response.ok || !body?.access_token) {
    if (body?.error === "invalid_grant") {
      cachedToken = null;
      await saveGmailStatus(admin, "reconnect_needed", "Google rejected the saved approval. Reconnect Gmail.");
      throw Object.assign(new Error("Gmail approval has expired. Reconnect Gmail."), { code: "reconnect_needed" });
    }
    throw new Error(`Could not refresh the Gmail token: ${body?.error ?? response.status}`);
  }
  const ttlMs = Math.max(60, (body.expires_in ?? 3600) - 300) * 1000;
  cachedToken = { token: body.access_token, expiresAt: Date.now() + ttlMs };
  return body.access_token;
}

function base64UrlEncode(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function encodedHeaderWord(value: string): string {
  // RFC 2047 encoded-word so non-ASCII subjects survive.
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `=?UTF-8?B?${btoa(binary)}?=`;
}

// NS22: build a multipart/alternative MIME message (text part + html part).
export function buildMime(input: GmailSendInput): string {
  const boundary = "lc-boundary-" + crypto.randomUUID();
  const headers = [
    `From: ${input.fromName ? `"${encodedHeaderWord(input.fromName)}" ` : ""}<${input.from}>`,
    `To: <${input.to}>`,
    input.replyTo ? `Reply-To: <${input.replyTo}>` : null,
    `Subject: ${encodedHeaderWord(input.subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ].filter(Boolean);
  return [
    headers.join("\r\n"),
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    input.text,
    "",
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    input.html,
    "",
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

export async function sendViaGmail(admin: SupabaseClient, input: GmailSendInput): Promise<GmailSendResult> {
  // Gmail SMTP (app password) takes priority when its secrets are set.
  const smtp = gmailSmtpCredentials();
  if (smtp) {
    return await sendViaGmailSmtp(smtp, {
      fromName: input.fromName,
      to: input.to,
      replyTo: input.replyTo,
      subject: input.subject,
      html: input.html,
      text: input.text,
    });
  }

  let token: string;
  try {
    token = await getAccessToken(admin);
  } catch (tokenError) {
    const code = (tokenError as { code?: string }).code;
    return {
      ok: false,
      kind: code === "reconnect_needed" || code === "not_connected" ? "reconnect_needed" : "failed",
      error: tokenError instanceof Error ? tokenError.message : String(tokenError),
    };
  }

  const raw = base64UrlEncode(buildMime(input));
  const url = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ raw }),
    });
    if (response.status === 200) return { ok: true };

    const detail = (await response.text().catch(() => "")).slice(0, 500);

    if (response.status === 401 || response.status === 403) {
      const message = response.status === 401
        ? "Gmail approval is no longer valid. Reconnect Gmail."
        : `Gmail rejected the send (${response.status}): ${detail}`;
      if (response.status === 401) await saveGmailStatus(admin, "reconnect_needed", message);
      return { ok: false, kind: response.status === 401 ? "reconnect_needed" : "failed", error: message };
    }
    if ((response.status === 429 || response.status >= 500) && attempt === 1) {
      const retryAfter = Number(response.headers.get("Retry-After"));
      const waitSeconds = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 30) : 5;
      await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000));
      continue;
    }
    return { ok: false, kind: "failed", error: `Gmail replied ${response.status}: ${detail}` };
  }
  return { ok: false, kind: "failed", error: "Gmail kept rate-limiting the send after one retry." };
}
