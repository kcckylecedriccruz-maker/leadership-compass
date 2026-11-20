import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.57.4";
import { type Caller, parseInput, RequestError, submitForAssessor } from "../_shared/submission.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function requireCaller(admin: SupabaseClient, req: Request): Promise<Caller> {
  const header = req.headers.get("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) throw new RequestError(401, "Please sign in again.");
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) throw new RequestError(401, "Please sign in again.");
  const { data: profile, error } = await admin
    .from("profiles")
    .select("id, email")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (error) throw new Error(`Could not load caller profile: ${error.message}`);
  if (!profile) throw new RequestError(403, "Your account is not set up for this action.");
  return { id: profile.id, email: profile.email };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  try {
    if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const caller = await requireCaller(admin, req);
    const input = parseInput(await req.json().catch(() => null));
    const result = await submitForAssessor(admin, caller, input, { via: "app" });
    return json(result.body, result.status);
  } catch (error) {
    if (error instanceof RequestError) return json({ error: error.message, ...error.details }, error.status);
    console.error("submit-assessment failed:", error instanceof Error ? error.message : error);
    return json({ error: "Something went wrong while submitting. Please try again." }, 500);
  }
});
