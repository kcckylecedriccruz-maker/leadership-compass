import type { SupabaseClient } from "npm:@supabase/supabase-js@2.57.4";

/**
 * Secure links let people without an active account fill in their forms.
 *
 * One link per person per cycle (table evaluation_links). The token is
 *   <link id>.<version>.<HMAC-SHA256(link id + version)>
 * so nothing secret is stored in the database. Resending bumps the version (old links stop working), revoking
 * sets revoked_at, and every link stops working when the cycle is no longer open.
 */

export type LinkRow = {
  id: string;
  profile_id: string;
  cycle_id: string;
  version: number;
  revoked_at: string | null;
};

export type ResolvedLink = {
  link: LinkRow;
  person: { id: string; full_name: string; email: string; person_type: string; activated_at: string | null; is_active: boolean };
  cycle: { id: string; name: string; status: string; closes_at: string };
};

export class LinkError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const INVALID_LINK = "This link is not valid any more. Ask your administrator to send you a new one.";

const TOKEN_PATTERN = /^([0-9a-f-]{36})\.(\d{1,6})\.([A-Za-z0-9_-]{43})$/;

function signingKey(): string {
  const key = Deno.env.get("LINK_SIGNING_SECRET") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!key) throw new Error("No signing key is configured for evaluation links.");
  return key;
}

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function signature(linkId: string, version: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(signingKey()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`evaluation-link:${linkId}:${version}`));
  return base64Url(new Uint8Array(mac));
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function tokenFor(link: Pick<LinkRow, "id" | "version">): Promise<string> {
  return `${link.id}.${link.version}.${await signature(link.id, link.version)}`;
}

export function linkUrl(appUrl: string, token: string): string {
  return `${appUrl}/e/${token}`;
}

/** Returns the current token for this person and cycle, creating the link if needed (and un-revoking it). */
export async function currentLinkToken(admin: SupabaseClient, profileId: string, cycleId: string): Promise<string> {
  const { data: existing, error } = await admin
    .from("evaluation_links")
    .select("id, version, revoked_at")
    .eq("profile_id", profileId)
    .eq("cycle_id", cycleId)
    .maybeSingle();
  if (error) throw new Error(`Could not load the link: ${error.message}`);

  if (existing) {
    // A revoked link is replaced: the next email carries a new version.
    const version = existing.revoked_at ? existing.version + 1 : existing.version;
    const { error: updateError } = await admin
      .from("evaluation_links")
      .update({ version, revoked_at: null, last_sent_at: new Date().toISOString() })
      .eq("id", existing.id);
    if (updateError) throw new Error(`Could not update the link: ${updateError.message}`);
    return tokenFor({ id: existing.id, version });
  }

  const { data: created, error: insertError } = await admin
    .from("evaluation_links")
    .upsert(
      { profile_id: profileId, cycle_id: cycleId, last_sent_at: new Date().toISOString() },
      { onConflict: "profile_id,cycle_id" },
    )
    .select("id, version")
    .single();
  if (insertError || !created) throw new Error(`Could not create the link: ${insertError?.message ?? "unknown"}`);
  return tokenFor(created);
}

/** Replaces the link: earlier emails stop working. */
export async function rotateLink(admin: SupabaseClient, profileId: string, cycleId: string): Promise<string> {
  const { data: existing } = await admin
    .from("evaluation_links")
    .select("id, version")
    .eq("profile_id", profileId)
    .eq("cycle_id", cycleId)
    .maybeSingle();
  if (!existing) return currentLinkToken(admin, profileId, cycleId);
  const version = existing.version + 1;
  const { error } = await admin
    .from("evaluation_links")
    .update({ version, revoked_at: null, last_sent_at: new Date().toISOString() })
    .eq("id", existing.id);
  if (error) throw new Error(`Could not replace the link: ${error.message}`);
  return tokenFor({ id: existing.id, version });
}

export async function revokeLink(admin: SupabaseClient, profileId: string, cycleId: string): Promise<boolean> {
  const { data, error } = await admin
    .from("evaluation_links")
    .update({ revoked_at: new Date().toISOString() })
    .eq("profile_id", profileId)
    .eq("cycle_id", cycleId)
    .is("revoked_at", null)
    .select("id");
  if (error) throw new Error(`Could not revoke the link: ${error.message}`);
  return (data ?? []).length > 0;
}

/** Checks a token and returns who it belongs to. Throws LinkError for anything that is not a working link. */
export async function resolveLink(admin: SupabaseClient, token: unknown): Promise<ResolvedLink> {
  if (typeof token !== "string") throw new LinkError(404, INVALID_LINK);
  const match = TOKEN_PATTERN.exec(token.trim());
  if (!match) throw new LinkError(404, INVALID_LINK);
  const [, linkId, versionText, sig] = match;
  const version = Number(versionText);
  if (!safeEqual(sig, await signature(linkId, version))) throw new LinkError(404, INVALID_LINK);

  const { data, error } = await admin
    .from("evaluation_links")
    .select(
      "id, profile_id, cycle_id, version, revoked_at, person:profiles!profile_id(id, full_name, email, person_type, activated_at, is_active), cycle:cycles!cycle_id(id, name, status, closes_at)",
    )
    .eq("id", linkId)
    .maybeSingle();
  if (error) throw new Error(`Could not load the link: ${error.message}`);
  const row = data as unknown as (LinkRow & { person: ResolvedLink["person"]; cycle: ResolvedLink["cycle"] }) | null;
  if (!row || row.version !== version || row.revoked_at) throw new LinkError(404, INVALID_LINK);
  if (!row.person.is_active) throw new LinkError(403, "This link is no longer active.");

  await admin.from("evaluation_links").update({ last_used_at: new Date().toISOString() }).eq("id", row.id);
  return {
    link: { id: row.id, profile_id: row.profile_id, cycle_id: row.cycle_id, version: row.version, revoked_at: row.revoked_at },
    person: row.person,
    cycle: row.cycle,
  };
}

/** People who answer by link: anyone who has not activated an account (quick-adds, externals, not yet activated). */
export function usesLink(person: { activated_at: string | null; person_type?: string | null }): boolean {
  return person.person_type === "external" || !person.activated_at;
}
