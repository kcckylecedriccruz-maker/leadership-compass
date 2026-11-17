import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import {
  addSelfAssessments,
  type Admin,
  findTalentId,
  notifyManagerAssignments,
  insertTalent,
  json,
  loadProfile,
  RequestError,
  removeTalentSetup,
  requireAdmin,
  sendTalentAddedEmail,
  corsHeaders,
  UUID_PATTERN,
} from "../_shared/talent-setup.ts";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_CHARACTERS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

function randomPassword(length = 12): string {
  const values = new Uint32Array(length);
  crypto.getRandomValues(values);
  return Array.from(values, (value) => PASSWORD_CHARACTERS[value % PASSWORD_CHARACTERS.length]).join("");
}

type PersonInput = { fullName: string; email: string };

function parsePerson(raw: unknown, label: string): PersonInput {
  if (typeof raw !== "object" || raw === null) throw new RequestError(400, `Enter the ${label} details.`);
  const value = raw as Record<string, unknown>;
  const fullName = typeof value.full_name === "string" ? value.full_name.trim() : "";
  const email = typeof value.email === "string" ? value.email.trim().toLowerCase() : "";
  if (!fullName || fullName.length > 200) throw new RequestError(400, `Enter the ${label}'s name.`);
  if (!EMAIL_PATTERN.test(email) || email.length > 254) {
    throw new RequestError(400, `Enter a valid email address for the ${label}.`);
  }
  return { fullName, email };
}

function optionalText(value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new RequestError(400, `${label} is not valid.`);
  const trimmed = value.trim();
  if (trimmed.length > 200) throw new RequestError(400, `${label} is too long.`);
  return trimmed || null;
}

type TalentInput = { kind: "existing"; profileId: string } | { kind: "new"; person: PersonInput };

type Input = {
  talent: TalentInput;
  department: string | null;
  position: string | null;
  managerIds: string[];
  primaryManagerId: string | null;
  newManager: PersonInput | null;
};

function parseTalent(raw: Record<string, unknown>): TalentInput {
  if (typeof raw.talent_profile_id === "string") {
    if (!UUID_PATTERN.test(raw.talent_profile_id)) throw new RequestError(400, "Choose a valid person for the talent.");
    return { kind: "existing", profileId: raw.talent_profile_id };
  }
  return { kind: "new", person: parsePerson(raw, "talent") };
}

function parseInput(body: unknown): Input {
  if (typeof body !== "object" || body === null) throw new RequestError(400, "The request was not understood.");
  const raw = body as Record<string, unknown>;

  const managerIds = Array.isArray(raw.manager_ids) ? raw.manager_ids : [];
  if (managerIds.some((id) => typeof id !== "string" || !UUID_PATTERN.test(id))) {
    throw new RequestError(400, "Choose valid managers.");
  }
  const primaryManagerId = typeof raw.primary_manager_id === "string" ? raw.primary_manager_id : null;
  if (primaryManagerId && !managerIds.includes(primaryManagerId)) {
    throw new RequestError(400, "The primary manager must be one of the selected managers.");
  }
  const newManager = raw.new_manager ? parsePerson(raw.new_manager, "new manager") : null;
  if (managerIds.length === 0 && !newManager) throw new RequestError(400, "Choose at least one immediate manager for this talent.");

  return {
    talent: parseTalent(raw),
    department: optionalText(raw.department, "Department"),
    position: optionalText(raw.position, "Position"),
    managerIds: managerIds as string[],
    primaryManagerId,
    newManager,
  };
}

async function assertEmailFree(admin: Admin, email: string): Promise<void> {
  const { data, error } = await admin.from("profiles").select("id").eq("email", email).maybeSingle();
  if (error) throw new Error(`Could not check email: ${error.message}`);
  if (data) throw new RequestError(409, `An account already exists for ${email}. Choose the existing person instead.`);
}

type CreatedAccount = { id: string; email: string; fullName: string; role: string; temporaryPassword: string };

async function createAccount(admin: Admin, person: PersonInput, role: string): Promise<CreatedAccount> {
  const password = randomPassword();
  const { data, error } = await admin.auth.admin.createUser({
    email: person.email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`Could not create auth user: ${error?.message ?? "unknown error"}`);

  const { error: profileError } = await admin.from("profiles").insert({
    id: data.user.id,
    full_name: person.fullName,
    email: person.email,
    role,
    must_change_password: true,
  });
  if (profileError) {
    await admin.auth.admin.deleteUser(data.user.id);
    throw new Error(`Could not create profile: ${profileError.message}`);
  }
  return {
    id: data.user.id,
    email: person.email,
    fullName: person.fullName,
    role,
    temporaryPassword: password,
  };
}

async function removeAccount(admin: Admin, userId: string): Promise<void> {
  await admin.from("profiles").delete().eq("id", userId);
  await admin.auth.admin.deleteUser(userId);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const createdAccountIds: string[] = [];
  let createdTalentId: string | null = null;

  try {
    if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

    const callerId = await requireAdmin(admin, req);
    const input = parseInput(await req.json().catch(() => null));

    let existingTalentEmail: string | null = null;
    let talentProfileId: string | null = null;
    if (input.talent.kind === "existing") {
      const profile = await loadProfile(admin, input.talent.profileId);
      if (await findTalentId(admin, profile.id)) throw new RequestError(409, "This person is already a talent.");
      talentProfileId = profile.id;
      existingTalentEmail = profile.email;
    } else {
      await assertEmailFree(admin, input.talent.person.email);
    }

    const talentEmail = input.talent.kind === "new" ? input.talent.person.email : existingTalentEmail;
    if (input.newManager) {
      if (input.newManager.email === talentEmail) {
        throw new RequestError(400, "The talent and their manager need different email addresses.");
      }
      await assertEmailFree(admin, input.newManager.email);
    }

    let managerIds = input.managerIds;
    for (const managerId of managerIds) await loadProfile(admin, managerId);
    if (talentProfileId && managerIds.includes(talentProfileId)) {
      throw new RequestError(400, "A talent cannot be their own immediate manager.");
    }

    let primaryManagerId = input.primaryManagerId;
    if (input.newManager) {
      const created = await createAccount(admin, input.newManager, "assessor");
      createdAccountIds.push(created.id);
      managerIds = [...managerIds, created.id];
      primaryManagerId = primaryManagerId ?? created.id;
    }

    const accounts: CreatedAccount[] = [];
    if (input.talent.kind === "new") {
      const talentAccount = await createAccount(admin, input.talent.person, "talent");
      createdAccountIds.push(talentAccount.id);
      accounts.push(talentAccount);
      talentProfileId = talentAccount.id;
    }
    if (!talentProfileId) throw new Error("Talent profile was not resolved.");
    if (managerIds.includes(talentProfileId)) {
      throw new RequestError(400, "A talent cannot be their own immediate manager.");
    }

    const existingPerson = input.talent.kind === "existing";
    const talentId = await insertTalent(admin, callerId, {
      profileId: talentProfileId,
      managers: { managerIds, primaryManagerId: primaryManagerId ?? managerIds[0] ?? null },
      department: input.department,
      position: input.position,
      existingPerson,
    });
    createdTalentId = talentId;

    const selfCycles = existingPerson ? await addSelfAssessments(admin, callerId, talentId, talentProfileId) : [];
    const failedCycles = await notifyManagerAssignments(admin, talentId);
    const talentEmailSent = existingPerson && talentEmail ? await sendTalentAddedEmail(talentEmail) : null;

    return json(
      {
        talent_id: talentId,
        existing_person: existingPerson,
        self_cycles: selfCycles,
        talent_email_sent: talentEmailSent,
        failed_cycles: failedCycles,
        accounts: accounts.map((account) => ({
          full_name: account.fullName,
          email: account.email,
          role: account.role,
          temporary_password: account.temporaryPassword,
        })),
      },
      201,
    );
  } catch (error) {
    if (createdTalentId) await removeTalentSetup(admin, createdTalentId);
    for (const userId of createdAccountIds.reverse()) {
      await removeAccount(admin, userId).catch(() => undefined);
    }
    if (error instanceof RequestError) return json({ error: error.message }, error.status);
    console.error("create-talent failed:", error instanceof Error ? error.message : error);
    return json({ error: "Something went wrong while adding this talent. Please try again." }, 500);
  }
});
