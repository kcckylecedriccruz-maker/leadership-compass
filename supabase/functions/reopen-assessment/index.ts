import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const TOKEN_PATTERN = /^[0-9a-f]{64}$/;
const INVALID_LINK_MESSAGE = "This link is not valid or has already been used.";

class RequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type Admin = SupabaseClient;

async function requireCallerId(admin: Admin, req: Request): Promise<string> {
  const header = req.headers.get("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) throw new RequestError(401, "Please sign in again.");

  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) throw new RequestError(401, "Please sign in again.");

  const { data: profile, error } = await admin
    .from("profiles")
    .select("id")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (error) throw new Error(`Could not load caller profile: ${error.message}`);
  if (!profile) throw new RequestError(403, "Your account is not set up for this action.");
  return profile.id;
}

function readToken(body: unknown): string {
  if (typeof body !== "object" || body === null) throw new RequestError(404, INVALID_LINK_MESSAGE);
  const token = (body as Record<string, unknown>).token;
  if (typeof token !== "string" || !TOKEN_PATTERN.test(token)) throw new RequestError(404, INVALID_LINK_MESSAGE);
  return token;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

type AssignmentRow = {
  id: string;
  assessor_id: string;
  cycle_id: string;
  talent_id: string;
  status: string;
  submitted_at: string | null;
  cycles: { name: string; status: string; closes_at: string };
  talents: { profile: { full_name: string } };
};

async function loadByTokenHash(admin: Admin, tokenHash: string): Promise<AssignmentRow | null> {
  const { data, error } = await admin
    .from("assignments")
    .select(
      "id, assessor_id, cycle_id, talent_id, status, submitted_at, cycles(name, status, closes_at), talents(profile:profiles!profile_id(full_name))",
    )
    .eq("edit_token_hash", tokenHash)
    .maybeSingle();
  if (error) throw new Error(`Could not load assessment: ${error.message}`);
  return data as AssignmentRow | null;
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

    const callerId = await requireCallerId(admin, req);
    const token = readToken(await req.json().catch(() => null));
    const tokenHash = await sha256Hex(token);

    const assignment = await loadByTokenHash(admin, tokenHash);
    if (!assignment) throw new RequestError(404, INVALID_LINK_MESSAGE);
    if (assignment.assessor_id !== callerId) {
      throw new RequestError(403, "This link was sent to a different assessor. Sign in with the account it was sent to.");
    }
    if (assignment.cycles.status !== "open" || Date.parse(assignment.cycles.closes_at) <= Date.now()) {
      throw new RequestError(409, "This cycle has closed, so your responses can no longer be changed.");
    }

    const { data: reopened, error: reopenError } = await admin
      .from("assignments")
      .update({ status: "draft", submitted_at: null, edit_token_hash: null })
      .eq("id", assignment.id)
      .eq("edit_token_hash", tokenHash)
      .select("id")
      .maybeSingle();
    if (reopenError) throw new Error(`Could not reopen the assessment: ${reopenError.message}`);
    if (!reopened) throw new RequestError(404, INVALID_LINK_MESSAGE);

    const { error: auditError } = await admin.from("audit_log").insert({
      actor_id: callerId,
      action: "assignment.reopened",
      entity: "assignment",
      entity_id: assignment.id,
      details: { cycle_id: assignment.cycle_id, talent_id: assignment.talent_id },
    });
    if (auditError) {
      await admin
        .from("assignments")
        .update({ status: assignment.status, submitted_at: assignment.submitted_at, edit_token_hash: tokenHash })
        .eq("id", assignment.id);
      throw new Error(`Could not record the change: ${auditError.message}`);
    }

    return json(
      {
        assignment_id: assignment.id,
        status: "draft",
        talent_name: assignment.talents.profile.full_name,
        cycle_name: assignment.cycles.name,
      },
      200,
    );
  } catch (error) {
    if (error instanceof RequestError) return json({ error: error.message }, error.status);
    console.error("reopen-assessment failed:", error instanceof Error ? error.message : error);
    return json({ error: "Something went wrong while reopening your feedback. Please try again." }, 500);
  }
});
