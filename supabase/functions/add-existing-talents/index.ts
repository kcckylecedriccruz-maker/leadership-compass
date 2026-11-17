import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import {
  addSelfAssessments,
  corsHeaders,
  findTalentId,
  notifyManagerAssignments,
  insertTalent,
  json,
  loadProfile,
  RequestError,
  removeTalentSetup,
  requireAdmin,
  sendTalentAddedEmail,
  UUID_PATTERN,
  type Admin,
  type ManagerSelection,
} from "../_shared/talent-setup.ts";

const MAX_PEOPLE = 50;

type PersonRequest = { profileId: string; managers: ManagerSelection };

function parsePeople(body: unknown): PersonRequest[] {
  if (typeof body !== "object" || body === null) throw new RequestError(400, "The request was not understood.");
  const people = (body as Record<string, unknown>).people;
  if (!Array.isArray(people) || people.length === 0) throw new RequestError(400, "Choose at least one person.");
  if (people.length > MAX_PEOPLE) throw new RequestError(400, `Add up to ${MAX_PEOPLE} people at a time.`);

  const seen = new Set<string>();
  return people.map((raw) => {
    const value = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
    const profileId = value.profile_id;
    const managerIds = Array.isArray(value.manager_ids) ? value.manager_ids : [];
    const primary = typeof value.primary_manager_id === "string" ? value.primary_manager_id : null;
    if (typeof profileId !== "string" || !UUID_PATTERN.test(profileId)) {
      throw new RequestError(400, "One of the selected people is not valid.");
    }
    if (managerIds.some((id) => typeof id !== "string" || !UUID_PATTERN.test(id))) {
      throw new RequestError(400, "One of the chosen managers is not valid.");
    }
    if (managerIds.includes(profileId)) throw new RequestError(400, "A person cannot be their own immediate manager.");
    if (primary && !managerIds.includes(primary)) {
      throw new RequestError(400, "The primary manager must be one of the selected managers.");
    }
    if (seen.has(profileId)) throw new RequestError(400, "Each person can only be selected once.");
    seen.add(profileId);
    return { profileId, managers: { managerIds: managerIds as string[], primaryManagerId: primary ?? (managerIds[0] as string | undefined) ?? null } };
  });
}

type AddedPerson = {
  profile_id: string;
  full_name: string;
  talent_id: string;
  manager_needed: boolean;
  self_cycles: string[];
  failed_cycles: string[];
  email_sent: boolean;
};

type SkippedPerson = { profile_id: string; full_name: string };

type FailedPerson = { profile_id: string; full_name: string; message: string };

type PersonOutcome = { kind: "added"; person: AddedPerson } | { kind: "skipped"; person: SkippedPerson };

async function addPerson(
  admin: Admin,
  callerId: string,
  person: PersonRequest,
): Promise<PersonOutcome> {
  const profile = await loadProfile(admin, person.profileId);
  if (await findTalentId(admin, profile.id)) {
    return { kind: "skipped", person: { profile_id: profile.id, full_name: profile.full_name } };
  }
  for (const managerId of person.managers.managerIds) await loadProfile(admin, managerId);

  let talentId: string | null = null;
  try {
    talentId = await insertTalent(admin, callerId, {
      profileId: profile.id,
      managers: person.managers,
      department: null,
      position: null,
      existingPerson: true,
    });
    const selfCycles = await addSelfAssessments(admin, callerId, talentId, profile.id);
    const failedCycles = await notifyManagerAssignments(admin, talentId);
    const emailSent = await sendTalentAddedEmail(profile.email);
    return {
      kind: "added",
      person: {
        profile_id: profile.id,
        full_name: profile.full_name,
        talent_id: talentId,
        manager_needed: person.managers.managerIds.length === 0,
        self_cycles: selfCycles,
        failed_cycles: failedCycles,
        email_sent: emailSent,
      },
    };
  } catch (error) {
    if (talentId) await removeTalentSetup(admin, talentId);
    throw error;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  try {
    const callerId = await requireAdmin(admin, req);
    const people = parsePeople(await req.json().catch(() => null));

    const added: AddedPerson[] = [];
    const skipped: SkippedPerson[] = [];
    const failed: FailedPerson[] = [];

    for (const person of people) {
      try {
        const outcome = await addPerson(admin, callerId, person);
        if (outcome.kind === "added") {
          added.push(outcome.person);
        } else {
          skipped.push(outcome.person);
        }
      } catch (error) {
        const name = await admin.from("profiles").select("full_name").eq("id", person.profileId).maybeSingle();
        const message = error instanceof RequestError ? error.message : "Could not add this person as a talent.";
        if (!(error instanceof RequestError)) {
          console.error("add-existing-talents failed for", person.profileId, error instanceof Error ? error.message : error);
        }
        failed.push({
          profile_id: person.profileId,
          full_name: name.data?.full_name ?? "Unknown person",
          message,
        });
      }
    }

    const { error: auditError } = await admin.from("audit_log").insert({
      actor_id: callerId,
      action: "talent.bulk_added",
      entity: "talent",
      entity_id: null,
      details: {
        added: added.map((person) => ({ profile_id: person.profile_id, talent_id: person.talent_id, manager_needed: person.manager_needed })),
        skipped: skipped.map((person) => person.profile_id),
        failed: failed.map((person) => person.profile_id),
      },
    });
    if (auditError) console.error("Bulk talent audit failed:", auditError.message);

    return json(
      {
        added,
        skipped,
        failed,
      },
      200,
    );
  } catch (error) {
    if (error instanceof RequestError) return json({ error: error.message }, error.status);
    console.error("add-existing-talents failed:", error instanceof Error ? error.message : error);
    return json({ error: "Something went wrong while adding these talents. Please try again." }, 500);
  }
});
