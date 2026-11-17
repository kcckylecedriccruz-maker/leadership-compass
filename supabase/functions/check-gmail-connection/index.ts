import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { hasModuleById } from "../_shared/access.ts";
import { sendViaGmail } from "../_shared/gmailMail.ts";
import { gmailSmtpAccount } from "../_shared/gmailSmtp.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
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
    if (userError || !userData?.user) return json({ error: "Sign in to check the Gmail connection." }, 401);

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role, email")
      .eq("id", userData.user.id)
      .maybeSingle();
    if (profileError) return json({ error: "Could not load your profile." }, 500);
    const caller = profile as { role: string; email: string } | null;
    if (!caller || !(await hasModuleById(userData.user.id, "settings", "edit"))) {
      return json({ error: "You need edit access to Settings to check the Gmail connection." }, 403);
    }

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: settings } = await admin
      .from("app_settings")
      .select("gmail_token_secret_id, gmail_account, sender_name")
      .eq("id", 1)
      .maybeSingle();
    const row = settings as { gmail_token_secret_id: string | null; gmail_account: string | null; sender_name: string | null } | null;
    // Gmail SMTP (app password secrets) needs no OAuth approval: record its account.
    const smtpAccount = gmailSmtpAccount();
    if (!smtpAccount && (!row?.gmail_token_secret_id || !row.gmail_account)) {
      await admin.from("app_settings").upsert({ id: 1, gmail_status: "not_connected", gmail_status_error: null });
      return json({ status: "not_connected", error: "No Gmail account is connected." }, 200);
    }

    // The check itself is a real send through Gmail: NS21 wants the connection
    // proven end to end, not just a token refresh.
    // Gmail only sends as the connected account, so the check sends from it.
    const account = smtpAccount ?? row!.gmail_account!;
    const result = await sendViaGmail(admin, {
      fromName: row?.sender_name?.trim() || "Leadership Compass",
      from: account,
      replyTo: null,
      to: caller.email,
      subject: "Leadership Compass — Gmail connection check",
      html: `<p>The Gmail connection is working: this email was sent from ${account}. You can safely delete it.</p>`,
      text: `The Gmail connection is working: this email was sent from ${account}. You can safely delete it.`,
    });

    if (result.ok) {
      await admin.from("app_settings").upsert({
        id: 1,
        gmail_status: "connected",
        gmail_status_error: null,
        ...(smtpAccount ? { gmail_account: smtpAccount, gmail_connected_at: new Date().toISOString() } : {}),
      });
      return json({ status: "connected" }, 200);
    }

    await admin.from("app_settings").upsert({
      id: 1,
      gmail_status: result.kind === "reconnect_needed" ? "reconnect_needed" : "failed",
      gmail_status_error: result.error.slice(0, 500),
    });
    return json({ status: result.kind === "reconnect_needed" ? "reconnect_needed" : "failed", error: result.error }, 200);
  } catch (error) {
    console.error("check-gmail-connection failed:", error instanceof Error ? error.message : error);
    return json({ error: "Could not check the Gmail connection." }, 500);
  }
});
