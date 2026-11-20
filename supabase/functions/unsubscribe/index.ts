import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN_PATTERN = /^[0-9a-f]{64}$/i;
const ALWAYS_ON = new Set(["invite", "account_activation", "temporary_password"]);

function html(body: string): Response {
  return new Response(body, { status: 200, headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" } });
}

function page(title: string, message: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} - Leadership Compass</title>
</head>
<body style="margin:0;padding:0;background:#f5f7f8;font-family:system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#13212b;">
<div style="max-width:480px;margin:0 auto;padding:48px 16px;">
<div style="background:#ffffff;border:1px solid #dfe6ea;border-radius:20px;padding:32px 28px;">
<p style="margin:0 0 16px;font-size:13px;font-weight:600;color:#0f6e6a;">Leadership Compass</p>
<h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;">${title}</h1>
<p style="margin:0;font-size:15px;line-height:1.6;color:#556674;">${message}</p>
</div>
</div>
</body>
</html>`;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function sign(secret: string, profileId: string, emailType: string): Promise<string> {
  return sha256Hex(`${secret}:${profileId}:${emailType}`);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const profileId = url.searchParams.get("profile_id") ?? "";
    const emailType = url.searchParams.get("email_type") ?? "";
    const token = url.searchParams.get("token") ?? "";

    if (!UUID_PATTERN.test(profileId) || !emailType || !TOKEN_PATTERN.test(token)) {
      return html(page("Link not recognised", "This unsubscribe link is not valid. Open the app and change your notification settings instead."));
    }

    const secret = Deno.env.get("INTERNAL_SECRET");
    if (!secret) return html(page("Link not recognised", "The email service is not configured yet."));

    const expected = await sign(secret, profileId, emailType);
    if (token.length !== expected.length) {
      return html(page("Link not recognised", "This unsubscribe link is not valid."));
    }
    let diff = 0;
    for (let i = 0; i < expected.length; i += 1) diff |= expected.charCodeAt(i) ^ token.charCodeAt(i);
    if (diff !== 0) {
      return html(page("Link not recognised", "This unsubscribe link is not valid or has expired."));
    }

    if (ALWAYS_ON.has(emailType)) {
      return html(page("This email cannot be turned off", "Account access emails such as invitations and activation codes are always sent, so you can always reach your account."));
    }

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: profile } = await admin.from("profiles").select("role").eq("id", profileId).maybeSingle();
    if (!profile) return html(page("Link not recognised", "The account for this link no longer exists."));

    const role = (profile as { role: string }).role;
    const adminOnlyTypes = new Set(["submitted_alert", "dashboard_ready"]);
    const memberTypes = new Set(["submission_confirmation", "cycle_closed", "reminder"]);
    const { count: reports } = await admin.from("profiles").select("id", { count: "exact", head: true }).eq("manager_id", profileId);
    if (adminOnlyTypes.has(emailType) && role !== "admin" && (reports ?? 0) === 0) {
      return html(page("Link not recognised", "This email type is not available for your account."));
    }
    // Administrators can be assessors too, so member emails apply to everyone.
    void memberTypes;

    const { error } = await admin.from("notification_preferences").upsert(
      { profile_id: profileId, email_type: emailType, enabled: false, delivery: "instant", updated_at: new Date().toISOString() },
      { onConflict: "profile_id,email_type" },
    );
    if (error) {
      console.error("unsubscribe upsert failed:", error.message);
      return html(page("Something went wrong", "We could not save your choice. Please try again later."));
    }

    return html(page("You are unsubscribed", `You will no longer receive "${emailType.replace(/_/g, " ")}" emails. You can turn them back on in the app under Notification settings.`));
  } catch (error) {
    console.error("unsubscribe failed:", error instanceof Error ? error.message : error);
    return html(page("Something went wrong", "We could not save your choice. Please try again later."));
  }
});
