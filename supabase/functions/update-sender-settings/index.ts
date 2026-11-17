import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { hasModuleById } from "../_shared/access.ts";
import { deleteRefreshToken } from "../_shared/gmailMail.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RESEND_DOMAINS_URL = "https://api.resend.com/domains";

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

type DomainStatus = "verified" | "pending" | "not_set_up";

async function checkDomain(apiKey: string, senderEmail: string): Promise<DomainStatus> {
  const domain = senderEmail.split("@")[1];
  if (!domain) return "not_set_up";
  try {
    const response = await fetch(RESEND_DOMAINS_URL, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!response.ok) return "not_set_up";
    const body = (await response.json().catch(() => null)) as {
      data?: { name: string; status: string }[];
    } | null;
    const match = body?.data?.find((entry) => entry.name.toLowerCase() === domain.toLowerCase());
    if (!match) return "not_set_up";
    if (match.status === "verified") return "verified";
    return "pending";
  } catch {
    return "not_set_up";
  }
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
    if (userError || !userData?.user) return json({ error: "Sign in to change sender settings." }, 401);

    const { data: callerProfile, error: callerError } = await supabase
      .from("profiles")
      .select("role, email, full_name")
      .eq("id", userData.user.id)
      .maybeSingle();
    if (callerError) return json({ error: "Could not load your profile." }, 500);
    if (!callerProfile) return json({ error: "Profile not found." }, 404);
    if (!(await hasModuleById(userData.user.id, "settings", "edit"))) {
      return json({ error: "You need edit access to Settings to change sender settings." }, 403);
    }

    const body = (await req.json().catch(() => null)) as {
      sender_name?: unknown;
      sender_email?: unknown;
      reply_to_email?: unknown;
      confirmed_test_received?: unknown;
      email_provider?: unknown;
      disconnect_gmail?: unknown;
    } | null;

    const senderName = typeof body?.sender_name === "string" ? body.sender_name.trim().slice(0, 100) : "";
    const senderEmail = typeof body?.sender_email === "string" ? body.sender_email.trim().toLowerCase() : "";
    const replyToRaw = typeof body?.reply_to_email === "string" ? body.reply_to_email.trim().toLowerCase() : "";
    const emailProvider = body?.email_provider === "resend" ? "resend" : body?.email_provider === "gmail" ? "gmail" : null;
    if (!senderName) return json({ error: "Sender name is required." }, 400);
    if (!senderEmail || !EMAIL_PATTERN.test(senderEmail) || senderEmail.length > 254) {
      return json({ error: "Sender email must be a valid email address." }, 400);
    }
    if (replyToRaw && (!EMAIL_PATTERN.test(replyToRaw) || replyToRaw.length > 254)) {
      return json({ error: "Reply-to must be a valid email address." }, 400);
    }

    const resendKey = Deno.env.get("RESEND_API_KEY")?.trim() || null;

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: existing } = await admin.from("app_settings").select("*").eq("id", 1).maybeSingle();
    const previous = existing as Record<string, unknown> | null;
    const previousProvider = (previous?.email_provider as string | null) ?? null;
    const providerChanged = emailProvider !== null && emailProvider !== previousProvider;

    if (emailProvider === null && previousProvider === null) {
      return json({ error: "Choose an email provider." }, 400);
    }
    const effectiveProvider = emailProvider ?? (previousProvider as "gmail" | "resend");
    const addressChanged = (previous?.sender_email ?? null) !== senderEmail;
    const gmailConnected = Boolean(previous?.gmail_token_secret_id) && previous?.gmail_status !== "not_connected";
    const gmailAccount = ((previous?.gmail_account as string | null) ?? "").toLowerCase();

    // Gmail sends only as the connected account: a different address would be
    // silently rewritten by Gmail, so it is refused here instead.
    if (effectiveProvider === "gmail" && gmailConnected && gmailAccount && senderEmail !== gmailAccount && body?.disconnect_gmail !== true) {
      return json(
        {
          error: `Gmail is connected as ${gmailAccount}, so emails can only come from that address. Disconnect Gmail first, then save the new address and connect the new account.`,
        },
        409,
      );
    }

    // NS13 + NS18: a provider change or a new sender address needs a received
    // test email first. Exception: Gmail that is not yet connected; connecting
    // and "Check connection" are the test in that case.
    const testRequired = (providerChanged || addressChanged) && !(effectiveProvider === "gmail" && !gmailConnected);
    if (testRequired && body?.confirmed_test_received !== true && body?.disconnect_gmail !== true) {
      return json({ error: "Send a test email from the new address and confirm you received it before saving." }, 400);
    }

    let domainStatus = (previous?.sender_domain_status as string) ?? "not_set_up";

    // NS12: the Resend domain check applies only when Resend sends the email.
    if (effectiveProvider === "resend" && senderEmail && (addressChanged || providerChanged)) {
      if (!resendKey) {
        return json({ error: "RESEND_API_KEY is not set, so Resend cannot be used. Choose Gmail or add the key in Supabase secrets." }, 400);
      }
      const domainStatusChecked = await checkDomain(resendKey, senderEmail);
      domainStatus = domainStatusChecked;
      if (domainStatusChecked !== "verified") {
        return json(
          {
            error:
              domainStatusChecked === "pending"
                ? "The email domain is still being verified. Try again once verification completes."
                : "This email domain is not set up in the email service yet. Add and verify the domain first.",
            domain_status: domainStatusChecked,
          },
          409,
        );
      }
    }

    const next: Record<string, unknown> = {
      sender_name: senderName,
      sender_email: senderEmail,
      reply_to_email: replyToRaw || null,
      sender_domain_status: domainStatus,
      updated_by: userData.user.id,
      updated_at: new Date().toISOString(),
    };
    if (emailProvider) next.email_provider = emailProvider;
    if (senderEmail && (previous?.sender_email ?? null) !== senderEmail && domainStatus === "verified") {
      next.sender_verified_at = new Date().toISOString();
    }

    // NS22: disconnecting removes the Gmail approval entirely (Vault secret
    // deleted, status reset to not_connected) and can be combined with a save.
    if (body?.disconnect_gmail === true) {
      await deleteRefreshToken(admin);
      next.gmail_token_secret_id = null;
      next.gmail_account = null;
      next.gmail_connected_at = null;
      next.gmail_status = "not_connected";
      next.gmail_status_error = null;
    }

    const { error: saveError } = await admin.from("app_settings").upsert({ id: 1, ...next });
    if (saveError) return json({ error: "Could not save the sender settings." }, 500);

    const changed: Record<string, { from: unknown; to: unknown }> = {};
    const trackedKeys = body?.disconnect_gmail === true
      ? ["sender_name", "sender_email", "reply_to_email", "email_provider", "gmail_status"] as const
      : ["sender_name", "sender_email", "reply_to_email", "email_provider"] as const;
    for (const key of trackedKeys) {
      if ((previous?.[key] ?? null) !== (next[key] ?? null)) {
        changed[key] = { from: previous?.[key] ?? null, to: next[key] ?? null };
      }
    }
    if (body?.disconnect_gmail === true) changed.gmail_disconnected = { from: true, to: true };
    await admin.from("audit_log").insert({
      actor_id: userData.user.id,
      action: "sender_settings.update",
      entity: "app_settings",
      entity_id: "1",
      details: { changed, domain_status: domainStatus },
    });

    return json({ status: "saved", domain_status: domainStatus }, 200);
  } catch (error) {
    console.error("update-sender-settings failed:", error instanceof Error ? error.message : error);
    return json({ error: "Unexpected error while saving the sender settings." }, 500);
  }
});
