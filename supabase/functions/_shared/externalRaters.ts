import type { SupabaseClient } from "npm:@supabase/supabase-js@2.57.4";

export class ExternalRaterError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function randomPassword(): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
}

/**
 * Returns the external rater with this email, creating them if needed. An employee's email is refused (they are
 * added as a peer instead). External raters get a login only because every person needs one here; it is banned so
 * it can never sign in, and they answer by secure link.
 */
export async function findOrCreateExternal(
  admin: SupabaseClient,
  input: { email: string; fullName: string; organisation: string | null },
): Promise<{ id: string; email: string; fullName: string; created: boolean }> {
  const { data: existing, error: lookupError } = await admin
    .from("profiles")
    .select("id, email, full_name, person_type, is_active")
    .eq("email", input.email)
    .maybeSingle();
  if (lookupError) throw new Error(`Could not look up the external rater: ${lookupError.message}`);
  const found = existing as { id: string; email: string; full_name: string; person_type: string; is_active: boolean } | null;
  if (found) {
    if (found.person_type !== "external") {
      throw new ExternalRaterError(409, `${input.email} belongs to an employee. Add them as a Peer (or another type) instead.`);
    }
    if (!found.is_active) throw new ExternalRaterError(409, `${input.email} has been deactivated.`);
    return { id: found.id, email: found.email, fullName: found.full_name, created: false };
  }

  if (!input.fullName) throw new ExternalRaterError(400, "Enter the external rater's name.");
  const { data: created, error } = await admin.auth.admin.createUser({
    email: input.email,
    password: randomPassword(),
    email_confirm: true,
    ban_duration: "876000h",
    user_metadata: { full_name: input.fullName, external: true },
  });
  if (error || !created.user) {
    const taken = /already|registered|exists/i.test(error?.message ?? "");
    throw new ExternalRaterError(taken ? 409 : 500, taken ? `${input.email} is already in use.` : "Could not add the external rater.");
  }
  const { error: profileError } = await admin.from("profiles").insert({
    id: created.user.id,
    full_name: input.fullName,
    email: input.email,
    role: "employee",
    person_type: "external",
    organisation: input.organisation,
    must_change_password: false,
  });
  if (profileError) {
    await admin.auth.admin.deleteUser(created.user.id);
    throw new Error(`Could not save the external rater: ${profileError.message}`);
  }
  return { id: created.user.id, email: input.email, fullName: input.fullName, created: true };
}

/** Saves the rater on the employee so they carry over to future cycles, like approved peers. */
export async function linkExternalToEmployee(
  admin: SupabaseClient,
  employeeId: string,
  raterId: string,
  addedBy: string,
): Promise<void> {
  const { error } = await admin
    .from("external_raters")
    .upsert({ employee_id: employeeId, rater_id: raterId, added_by: addedBy }, { onConflict: "employee_id,rater_id", ignoreDuplicates: true });
  if (error) throw new Error(`Could not link the external rater: ${error.message}`);
}
