import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { hasModuleById } from "../_shared/access.ts";
import { readGoogleCredentials } from "../_shared/gmailMail.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const STATE_TTL_MS = 10 * 60 * 1000;

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

// NS19: the state is a nonce signed with INTERNAL_SECRET so the public callback
// can verify it without storing anything. It expires in 10 minutes and is tied
// to the requesting admin's user id.
async function signState(userId: string, expiryMs: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(Deno.env.get("INTERNAL_SECRET")!),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const payload = `${userId}.${expiryMs}`;
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  const hex = Array.from(new Uint8Array(signature)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${payload}.${hex}`;
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
    if (userError || !userData?.user) return json({ error: "Sign in to connect Gmail." }, 401);

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", userData.user.id)
      .maybeSingle();
    if (profileError) return json({ error: "Could not load your profile." }, 500);
    if (!profile || !(await hasModuleById(userData.user.id, "settings", "edit"))) {
      return json({ error: "You need edit access to Settings to connect Gmail." }, 403);
    }

    const credentials = readGoogleCredentials({ needSecret: true });
    if (!credentials.ok) return json({ error: credentials.error, setup_issue: true }, 500);
    const clientId = credentials.value.clientId;
    if (!Deno.env.get("INTERNAL_SECRET")) {
      return json({ error: "INTERNAL_SECRET is not set. Add it in Supabase > Edge Functions > Secrets.", setup_issue: true }, 500);
    }
    if (!Deno.env.get("APP_URL")) {
      return json({ error: "APP_URL is not set. Add your published app address in Supabase > Edge Functions > Secrets.", setup_issue: true }, 500);
    }

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: settings } = await admin.from("app_settings").select("sender_email").eq("id", 1).maybeSingle();
    const senderEmail = (settings as { sender_email: string | null } | null)?.sender_email ?? "";
    // The callback only accepts the account that matches the saved sender, so
    // the sender address must be saved first.
    if (!senderEmail) {
      return json({ error: "Save the sender email (the Gmail address emails come from) before connecting Gmail." }, 400);
    }

    const redirectUri = `${Deno.env.get("SUPABASE_URL")}/functions/v1/gmail-oauth-callback`;
    const state = await signState(userData.user.id, Date.now() + STATE_TTL_MS);
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("login_hint", senderEmail);
    url.searchParams.set("scope", "openid email https://www.googleapis.com/auth/gmail.send");
    url.searchParams.set("state", state);

    return json({ consent_url: url.toString() }, 200);
  } catch (error) {
    console.error("connect-gmail failed:", error instanceof Error ? error.message : error);
    return json({ error: "Could not start the Gmail connection." }, 500);
  }
});
