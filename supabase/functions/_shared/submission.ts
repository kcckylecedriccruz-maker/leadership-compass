import type { SupabaseClient } from "npm:@supabase/supabase-js@2.57.4";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ITEM_COUNT = 19;
const NOTE_MAX_LENGTH = 2000;

export class RequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}


type Admin = SupabaseClient;

export type Caller = { id: string; email: string };


function invalidFormat(): RequestError {
  return new RequestError(400, "The feedback was not in the right format.");
}

function readItemNumber(value: unknown): number {
  if (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= ITEM_COUNT) return value;
  throw invalidFormat();
}

function readRating(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 5) return value;
  throw invalidFormat();
}

function readNote(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw invalidFormat();
  const trimmed = value.trim();
  if (trimmed.length > NOTE_MAX_LENGTH) {
    throw new RequestError(400, `Behaviour notes can be up to ${NOTE_MAX_LENGTH} characters.`);
  }
  return trimmed || null;
}

type Answer = { competencyNumber: number; rating: number | null; note: string | null };

export type Input = { assignmentId: string; copyRequested: boolean; answers: Map<number, Answer> };

export function parseInput(body: unknown): Input {
  if (typeof body !== "object" || body === null) throw invalidFormat();
  const raw = body as Record<string, unknown>;

  const assignmentId = typeof raw.assignment_id === "string" ? raw.assignment_id : "";
  if (!UUID_PATTERN.test(assignmentId)) throw new RequestError(400, "This assessment could not be found.");

  if (raw.copy_requested !== undefined && typeof raw.copy_requested !== "boolean") throw invalidFormat();

  if (!Array.isArray(raw.responses)) throw invalidFormat();
  const answers = new Map<number, Answer>();
  for (const item of raw.responses) {
    if (typeof item !== "object" || item === null) throw invalidFormat();
    const entry = item as Record<string, unknown>;
    const number = readItemNumber(entry.sort_order);
    if (answers.has(number)) throw invalidFormat();
    answers.set(number, {
      competencyNumber: number,
      rating: readRating(entry.rating),
      note: readNote(entry.behaviour_note),
    });
  }

  return {
    assignmentId,
    copyRequested: raw.copy_requested === true,
    answers,
  };
}

type Gaps = { ratingMissing: number[]; noteMissing: number[] };

function findGaps(answers: Map<number, Answer>): Gaps {
  const ratingMissing: number[] = [];
  const noteMissing: number[] = [];
  for (let number = 1; number <= ITEM_COUNT; number += 1) {
    const answer = answers.get(number);
    if (!answer || answer.rating === null) ratingMissing.push(number);
    if (!answer || answer.note === null) noteMissing.push(number);
  }
  return { ratingMissing, noteMissing };
}

function joinNumbers(numbers: number[]): string {
  if (numbers.length <= 1) return numbers.join("");
  return `${numbers.slice(0, -1).join(", ")} and ${numbers[numbers.length - 1]}`;
}

function itemPhrase(numbers: number[], verb: string): string {
  const label = numbers.length === 1 ? "Item" : "Items";
  return `${label} ${joinNumbers(numbers)} ${numbers.length === 1 ? "needs" : "need"} ${verb}`;
}

function gapsMessage(gaps: Gaps): string | null {
  const bothMissing = gaps.ratingMissing.filter((number) => gaps.noteMissing.includes(number));
  const ratingOnly = gaps.ratingMissing.filter((number) => !bothMissing.includes(number));
  const noteOnly = gaps.noteMissing.filter((number) => !bothMissing.includes(number));

  const parts: string[] = [];
  if (bothMissing.length > 0) parts.push(itemPhrase(bothMissing, "a rating and a behaviour example"));
  if (ratingOnly.length > 0) parts.push(itemPhrase(ratingOnly, "a rating"));
  if (noteOnly.length > 0) {
    parts.push(
      noteOnly.length === 1
        ? `item ${noteOnly[0]} needs a behaviour example`
        : `items ${joinNumbers(noteOnly)} need a behaviour example`,
    );
  }
  return parts.length > 0 ? parts.join("; ") : null;
}

type AssignmentRow = {
  id: string;
  assessor_id: string;
  cycle_id: string;
  talent_id: string;
  status: string;
  submitted_at: string | null;
  copy_requested: boolean;
  cycles: { status: string; closes_at: string };
  talents: {
    profile: { full_name: string };
    manager: { email: string } | null;
  };
};

async function loadAssignment(admin: Admin, assignmentId: string): Promise<AssignmentRow | null> {
  const { data, error } = await admin
    .from("assignments")
    .select(
      "id, assessor_id, cycle_id, talent_id, status, submitted_at, copy_requested, cycles(status, closes_at), talents(profile:profiles!profile_id(full_name), manager:profiles!immediate_manager_id(email))",
    )
    .eq("id", assignmentId)
    .maybeSingle();
  if (error) throw new Error(`Could not load assignment: ${error.message}`);
  return data as AssignmentRow | null;
}

async function saveResponses(admin: Admin, assignmentId: string, answers: Map<number, Answer>): Promise<void> {
  const { data: competencies, error: competencyError } = await admin
    .from("competencies")
    .select("id, sort_order");
  if (competencyError) throw new Error(`Could not load competencies: ${competencyError.message}`);

  const idByNumber = new Map((competencies ?? []).map((row) => [row.sort_order as number, row.id as string]));
  const rows = [];
  for (let number = 1; number <= ITEM_COUNT; number += 1) {
    const answer = answers.get(number);
    const competencyId = idByNumber.get(number);
    if (!answer || !competencyId || answer.rating === null || answer.note === null) {
      throw new Error(`Missing complete answer for item ${number}.`);
    }
    rows.push({
      assignment_id: assignmentId,
      competency_id: competencyId,
      rating: answer.rating,
      behaviour_note: answer.note,
    });
  }

  const { error } = await admin.from("responses").upsert(rows, { onConflict: "assignment_id,competency_id" });
  if (error) throw new Error(`Could not save responses: ${error.message}`);
}

async function adminEmails(admin: Admin): Promise<string[]> {
  const { data, error } = await admin.from("profiles").select("email").eq("role", "admin");
  if (error) throw new Error(`Could not load administrators: ${error.message}`);
  return (data ?? []).map((row) => row.email as string);
}

async function allAssignmentsSubmitted(admin: Admin, cycleId: string, talentId: string): Promise<boolean> {
  const { data, error } = await admin
    .from("assignments")
    .select("status")
    .eq("cycle_id", cycleId)
    .eq("talent_id", talentId);
  if (error) throw new Error(`Could not check assessments: ${error.message}`);
  return (data ?? []).every((row) => row.status === "submitted");
}

async function claimDashboardNotice(admin: Admin, cycleId: string, talentId: string): Promise<boolean> {
  const { data, error } = await admin
    .from("dashboard_ready_notices")
    .upsert({ cycle_id: cycleId, talent_id: talentId }, { onConflict: "cycle_id,talent_id", ignoreDuplicates: true })
    .select("cycle_id");
  if (error) throw new Error(`Could not record dashboard notice: ${error.message}`);
  return (data ?? []).length > 0;
}

async function sendEmail(body: Record<string, unknown>): Promise<void> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const internalSecret = Deno.env.get("INTERNAL_SECRET");
  if (!supabaseUrl || !internalSecret) {
    console.error(`Email ${String(body.type)} not sent: INTERNAL_SECRET is not configured.`);
    return;
  }
  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-secret": internalSecret },
      body: JSON.stringify(body),
    });
    if (!response.ok) console.error(`Email ${String(body.type)} responded with status ${response.status}`);
  } catch (error) {
    console.error(`Email ${String(body.type)} request failed:`, error instanceof Error ? error.message : error);
  }
}

async function notifyAfterSubmission(admin: Admin, caller: Caller, assignment: AssignmentRow): Promise<void> {
  const sends: Promise<void>[] = [
    sendEmail({ type: "submission_confirmation", recipient_email: caller.email, assignment_id: assignment.id }),
  ];

  const alertRecipients = new Set<string>(await adminEmails(admin));
  const managerEmail = assignment.talents.manager?.email;
  if (managerEmail) alertRecipients.add(managerEmail);
  alertRecipients.delete(caller.email);
  for (const email of alertRecipients) {
    sends.push(sendEmail({ type: "submitted_alert", recipient_email: email, assignment_id: assignment.id }));
  }

  if (
    (await allAssignmentsSubmitted(admin, assignment.cycle_id, assignment.talent_id)) &&
    (await claimDashboardNotice(admin, assignment.cycle_id, assignment.talent_id))
  ) {
    for (const email of await adminEmails(admin)) {
      sends.push(
        sendEmail({
          type: "dashboard_ready",
          recipient_email: email,
          cycle_id: assignment.cycle_id,
          talent_id: assignment.talent_id,
        }),
      );
    }
  }

  await Promise.all(sends);
}


/**
 * Validates and submits one assessment for the given assessor (signed in, or identified by a secure link),
 * then sends the confirmation and alert emails. Returns the HTTP body and status to send back.
 */
export async function submitForAssessor(
  admin: Admin,
  caller: Caller,
  input: Input,
  options: { cycleId?: string; via?: "app" | "link" } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const assignment = await loadAssignment(admin, input.assignmentId);
  if (!assignment) throw new RequestError(404, "This assessment could not be found.");
  if (assignment.assessor_id !== caller.id) {
    throw new RequestError(403, "This assessment belongs to another assessor.");
  }
  if (options.cycleId && assignment.cycle_id !== options.cycleId) {
    throw new RequestError(403, "This assessment is not part of this link.");
  }
  if (assignment.status === "submitted") throw new RequestError(409, "This feedback has already been submitted.");
  if (assignment.cycles.status !== "open" || Date.parse(assignment.cycles.closes_at) <= Date.now()) {
    throw new RequestError(409, "This cycle has closed, so feedback can no longer be submitted.");
  }
  const gaps = findGaps(input.answers);
  const message = gapsMessage(gaps);
  if (message) {
    return { status: 422, body: { error: message, rating_missing: gaps.ratingMissing, note_missing: gaps.noteMissing } };
  }
  await saveResponses(admin, assignment.id, input.answers);
  const submittedAt = new Date().toISOString();
  const { data: updated, error: updateError } = await admin
    .from("assignments")
    .update({ status: "submitted", submitted_at: submittedAt, copy_requested: input.copyRequested })
    .eq("id", assignment.id)
    .neq("status", "submitted")
    .select("id")
    .maybeSingle();
  if (updateError) throw new Error(`Could not submit the feedback: ${updateError.message}`);
  if (!updated) throw new RequestError(409, "This feedback has already been submitted.");
  const { error: auditError } = await admin.from("audit_log").insert({
    actor_id: caller.id,
    action: "assignment.submitted",
    entity: "assignment",
    entity_id: assignment.id,
    details: {
      cycle_id: assignment.cycle_id,
      talent_id: assignment.talent_id,
      copy_requested: input.copyRequested,
      via: options.via ?? "app",
    },
  });
  if (auditError) {
    await admin
      .from("assignments")
      .update({ status: assignment.status, submitted_at: null, copy_requested: assignment.copy_requested })
      .eq("id", assignment.id);
    throw new Error(`Could not record the submission: ${auditError.message}`);
  }
  try {
    await notifyAfterSubmission(admin, caller, assignment);
  } catch (notifyError) {
    console.error("Submission emails failed:", notifyError instanceof Error ? notifyError.message : notifyError);
  }
  return { status: 200, body: { status: "submitted", assignment_id: assignment.id } };
}
