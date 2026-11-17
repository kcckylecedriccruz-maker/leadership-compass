import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { readGoogleCredentials, storeRefreshToken } from "../_shared/gmailMail.ts";

function appUrl(): string {
  return (Deno.env.get("APP_URL") ?? "").trim().replace(/\/+$/, "");
}

// The app has no URL router: ?settings=sender opens the sender settings page.
function settingsUrl(result: "connected" | "failed"): string {
  return `${appUrl()}/?settings=sender&gmail=${result}`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
}

// Plain-language explanations for the errors Google sends back.
const GOOGLE_ERRORS: Record<string, string> = {
  access_denied:
    "Google did not grant access. Either Allow was not clicked, or the Google Cloud app is still in Testing and this account is not a test user. Publish the app (Google Auth Platform > Audience > Publish app) or add the account as a test user, then try again.",
  org_internal:
    "This Google Cloud app is set to Internal, which only allows accounts in your Google Workspace. Approve with a Workspace account, or change the audience to External.",
  admin_policy_enforced:
    "Your Google Workspace admin blocks this app. Ask them to mark the OAuth client as Trusted in Admin console > Security > API controls.",
};

// The browser lands here straight from Google, so errors are shown as a page
// that links back to the sender settings screen.
function page(message: string, ok: boolean): Response {
  const color = ok ? "#15803d" : "#b91c1c";
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Gmail connection</title></head>
<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;">
<h1 style="color:${color};font-size:1.25rem;">${ok ? "Gmail connected" : "Gmail connection failed"}</h1>
<p style="line-height:1.5;">${escapeHtml(message)}</p>
<p><a href="${escapeHtml(settingsUrl(ok ? "connected" : "failed"))}" style="color:#2563eb;">Back to sender settings</a></p>
</body></html>`;
  return new Response(html, { status: ok ? 200 : 400, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

async function verifyState(state: string): Promise<string | null> {
  const parts = state.split(".");
  if (parts.length !== 3) return null;
  const [userId, expiryRaw, signature] = parts;
  const expiryMs = Number(expiryRaw);
  if (!Number.isFinite(expiryMs) || expiryMs < Date.now()) return null;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(Deno.env.get("INTERNAL_SECRET")!),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const expected = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${userId}.${expiryMs}`));
  const expectedHex = Array.from(new Uint8Array(expected)).map((b) => b.toString(16).padStart(2, "0")).join("");
  if (expectedHex.length !== signature.length) return null;
  let diff = 0;
  for (let i = 0; i < expectedHex.length; i += 1) diff |= expectedHex.charCodeAt(i) ^ signature.charCodeAt(i);
  if (diff !== 0) return null;
  return userId;
}

function emailFromIdToken(idToken: string): string | null {
  const payload = idToken.split(".")[1];
  if (!payload) return null;
  try {
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
    return (JSON.parse(json) as { email?: string }).email?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  try {
    const params = new URL(req.url).searchParams;
    const error = params.get("error");
    if (error) return page(GOOGLE_ERRORS[error] ?? `Google returned: ${error}`, false);

    const code = params.get("code");
    const state = params.get("state");
    if (!code || !state) return page("The approval response was incomplete.", false);

    const userId = await verifyState(state);
    if (!userId) return page("The approval link expired or is invalid. Start the connection again from the sender settings page.", false);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: settings } = await admin.from("app_settings").select("sender_email").eq("id", 1).maybeSingle();
    const senderEmail = (settings as { sender_email: string | null } | null)?.sender_email ?? "";

    const credentials = readGoogleCredentials({ needSecret: true });
    if (!credentials.ok) return page(credentials.error, false);
    const { clientId, clientSecret } = credentials.value;

    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: `${Deno.env.get("SUPABASE_URL")}/functions/v1/gmail-oauth-callback`,
        grant_type: "authorization_code",
      }),
    });
    const tokenBody = (await tokenResponse.json().catch(() => null)) as
      | { refresh_token?: string; id_token?: string; error?: string }
      | null;
    if (!tokenResponse.ok || !tokenBody?.refresh_token) {
      const reason = tokenBody?.error ?? String(tokenResponse.status);
      console.error("Gmail token exchange failed:", reason);
      const hint = reason === "invalid_client"
        ? "Google rejected the client ID or secret. Check GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Supabase match the client in Google Cloud."
        : reason === "redirect_uri_mismatch"
        ? `The redirect URI in Google Cloud must be exactly ${Deno.env.get("SUPABASE_URL")}/functions/v1/gmail-oauth-callback`
        : "Google did not return an approval. Start the connection again from the sender settings page.";
      return page(hint, false);
    }

    // NS20: the approved Google account must match the saved sender address.
    const approvedEmail = tokenBody.id_token ? emailFromIdToken(tokenBody.id_token) : null;
    if (!approvedEmail || approvedEmail !== senderEmail.toLowerCase()) {
      await admin
        .from("app_settings")
        .upsert({ id: 1, gmail_status: "failed", gmail_status_error: "Approved with the wrong account" });
      await admin.from("audit_log").insert({
        actor_id: userId,
        action: "gmail.connect_failed",
        entity: "app_settings",
        entity_id: "1",
        details: { reason: "wrong_account", approved_email: approvedEmail },
      });
      return page(
        `You approved with ${approvedEmail ?? "an unknown Google account"}, but emails are sent from ${senderEmail}. Approve again with the dedicated sender account.`,
        false,
      );
    }

    const secretId = await storeRefreshToken(admin, tokenBody.refresh_token);
    if (!secretId) return page("The Gmail approval could not be stored. Try again.", false);

    await admin.from("app_settings").upsert({
      id: 1,
      gmail_token_secret_id: secretId,
      gmail_account: approvedEmail,
      gmail_connected_at: new Date().toISOString(),
      gmail_status: "connected",
      gmail_status_error: null,
    });
    await admin.from("audit_log").insert({
      actor_id: userId,
      action: "gmail.connected",
      entity: "app_settings",
      entity_id: "1",
      details: { account: approvedEmail },
    });

    if (!appUrl()) return page(`Gmail is connected as ${approvedEmail}. Return to Leadership Compass and open Sender settings.`, true);
    return new Response(null, { status: 302, headers: { Location: settingsUrl("connected") } });
  } catch (error) {
    console.error("gmail-oauth-callback failed:", error instanceof Error ? error.message : error);
    return page("Something went wrong while connecting Gmail. Try again.", false);
  }
});
