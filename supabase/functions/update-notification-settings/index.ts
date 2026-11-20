import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { hasModuleById } from "../_shared/access.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const DELIVERIES = ["instant", "daily_digest"] as const;

type Delivery = (typeof DELIVERIES)[number];

const ALWAYS_ON = new Set(["invite", "account_activation", "temporary_password"]);

const ASSESSOR_TYPES = new Set(["submission_confirmation", "cycle_closed", "reminder"]);
const ADMIN_TYPES = new Set(["submitted_alert", "dashboard_ready"]);

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

type ProfileRow = { id: string; role: string };

export type UpsertResult = { ok: true } | { ok: false; status: number; error: string };

export async function handleUpsert(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData?.user) return json({ error: "Sign in to change notification settings." }, 401);
    const userId = userData.user.id;

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id, role")
      .eq("id", userId)
      .maybeSingle();
    if (profileError) return json({ error: "Could not load your profile." }, 500);
    if (!profile) return json({ error: "Profile not found." }, 404);
    const { role } = profile as ProfileRow;

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return json({ error: "The request body must be a JSON object." }, 400);

    // NS16: admins only — template overrides with placeholder protection.
    if (body.template) {
      if (!(await hasModuleById(userId, "settings", "edit"))) {
        return json({ error: "You need edit access to Settings to edit email templates." }, 403);
      }
      const tpl = body.template as Record<string, unknown>;
      const templateType = typeof tpl.email_type === "string" ? tpl.email_type.trim() : "";
      const subject = typeof tpl.subject === "string" ? tpl.subject.trim().slice(0, 300) : "";
      const message = typeof tpl.message === "string" ? tpl.message.trim().slice(0, 5000) : "";
      if (!templateType || !subject || !message) {
        return json({ error: "template requires email_type, subject and message." }, 400);
      }
      if (!subject.includes("{") || !message.includes("{")) {
        return json({ error: "Keep at least one {placeholder} in the subject and message." }, 400);
      }
      const serviceAdmin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { error: saveError } = await serviceAdmin.from("email_templates").upsert({
        email_type: templateType,
        subject,
        message,
        updated_by: userId,
        updated_at: new Date().toISOString(),
      });
      if (saveError) return json({ error: "Could not save the template." }, 500);
      return json({ status: "saved" }, 200);
    }

    const emailType = typeof body.email_type === "string" ? body.email_type.trim() : "";
    const enabled = body.enabled;
    const deliveryRaw = typeof body.delivery === "string" ? body.delivery : "instant";

    if (!emailType) return json({ error: "email_type is required." }, 400);
    if (typeof enabled !== "boolean") return json({ error: "enabled must be true or false." }, 400);
    if (!(DELIVERIES as readonly string[]).includes(deliveryRaw)) {
      return json({ error: "delivery must be instant or daily_digest." }, 400);
    }
    const delivery = deliveryRaw as Delivery;
    if (delivery === "daily_digest" && emailType !== "submitted_alert") {
      return json({ error: "Daily digest is only available for submitted alerts." }, 400);
    }

    if (ALWAYS_ON.has(emailType)) {
      return json({ error: "This email type is needed to access your account and cannot be turned off." }, 400);
    }

    const isAdmin = role === "admin";
    // Managers are people with direct reports in the org structure.
    const { count: reports } = await supabase.from("profiles").select("id", { count: "exact", head: true }).eq("manager_id", userId);
    const isManagerish = isAdmin || (reports ?? 0) > 0;
    if (ADMIN_TYPES.has(emailType)) {
      if (!isManagerish) {
        return json({ error: "This email type is only available to administrators and managers." }, 403);
      }
    } else if (!ASSESSOR_TYPES.has(emailType)) {
      // Everyone, administrators included, can be an assessor, so assessor emails apply to all.
      return json({ error: "Unknown email type." }, 400);
    }

    const { error: upsertError } = await supabase.from("notification_preferences").upsert(
      { profile_id: userId, email_type: emailType, enabled, delivery, updated_at: new Date().toISOString() },
      { onConflict: "profile_id,email_type" },
    );
    if (upsertError) return json({ error: "Could not save your notification settings." }, 500);

    return json({ status: "saved" }, 200);
  } catch (error) {
    console.error("update-notification-settings failed:", error instanceof Error ? error.message : error);
    return json({ error: "Unexpected error while saving notification settings." }, 500);
  }
}

Deno.serve(handleUpsert);
