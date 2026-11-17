import type { SupabaseClient } from "npm:@supabase/supabase-js@2.57.4";
import type { CopyRow, EmailData, EmailKind } from "./templates.ts";

export type EmailRequest = {
  kind: EmailKind;
  recipientEmail: string;
  assignmentId: string | null;
  cycleId: string | null;
  talentId: string | null;
  temporaryPassword: string | null;
  activationCode: string | null;
  isTest?: boolean;
  testedType?: string | null;
  checkResult?: string | null;
  senderFrom?: string | null;
};

export type PrepareResult =
  | { outcome: "ready"; data: EmailData; cycleId: string | null; assignmentId: string | null }
  | { outcome: "skipped"; reason: string }
  | { outcome: "rejected"; status: number; message: string };

type Admin = SupabaseClient;

type AssignmentRow = {
  id: string;
  cycle_id: string;
  talent_id: string;
  classification: "immediate_manager" | "direct_report" | "peer" | "self";
  status: string;
  copy_requested: boolean;
  cycles: { name: string; closes_at: string; status: string; alert_on_submit: boolean };
  talents: { profile: { full_name: string } };
};

const DAY_MS = 24 * 60 * 60 * 1000;

function rejected(status: number, message: string): PrepareResult {
  return { outcome: "rejected", status, message };
}

async function loadAssignment(admin: Admin, assignmentId: string): Promise<AssignmentRow | null> {
  const { data, error } = await admin
    .from("assignments")
    .select(
      "id, cycle_id, talent_id, classification, status, copy_requested, cycles(name, closes_at, status, alert_on_submit), talents(profile:profiles!profile_id(full_name))",
    )
    .eq("id", assignmentId)
    .maybeSingle();
  if (error) throw new Error(`Could not load assignment: ${error.message}`);
  return data as AssignmentRow | null;
}

async function loadRecipientName(admin: Admin, email: string): Promise<string | null> {
  const { data, error } = await admin
    .from("profiles")
    .select("full_name")
    .eq("email", email)
    .maybeSingle();
  if (error) throw new Error(`Could not load recipient: ${error.message}`);
  return data?.full_name ?? null;
}

function daysUntil(iso: string): number {
  return Math.max(0, Math.ceil((Date.parse(iso) - Date.now()) / DAY_MS));
}

function assessorLabel(classification: AssignmentRow["classification"]): string | null {
  if (classification === "immediate_manager") return "Immediate manager";
  if (classification === "self") return "Self";
  return null;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function randomTokenHex(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function prepareInvite(admin: Admin, appUrl: string, request: EmailRequest): Promise<PrepareResult> {
  const assignment = await loadAssignment(admin, requireId(request.assignmentId));
  if (!assignment) return rejected(404, "The assessment could not be found.");
  return {
    outcome: "ready",
    cycleId: assignment.cycle_id,
    assignmentId: assignment.id,
    data: {
      kind: "invite",
      recipientName: await loadRecipientName(admin, request.recipientEmail),
      recipientEmail: request.recipientEmail,
      talentName: assignment.talents.profile.full_name,
      cycleName: assignment.cycles.name,
      closesAt: assignment.cycles.closes_at,
      temporaryPassword: request.temporaryPassword,
      loginUrl: `${appUrl}/`,
    },
  };
}

async function prepareSubmittedAlert(admin: Admin, appUrl: string, request: EmailRequest): Promise<PrepareResult> {
  const assignment = await loadAssignment(admin, requireId(request.assignmentId));
  if (!assignment) return rejected(404, "The assessment could not be found.");
  if (assignment.status !== "submitted") return rejected(409, "This assessment has not been submitted.");
  if (!assignment.cycles.alert_on_submit) {
    return { outcome: "skipped", reason: "Submission alerts are turned off for this cycle." };
  }
  return {
    outcome: "ready",
    cycleId: assignment.cycle_id,
    assignmentId: assignment.id,
    data: {
      kind: "submitted_alert",
      recipientName: await loadRecipientName(admin, request.recipientEmail),
      talentName: assignment.talents.profile.full_name,
      cycleName: assignment.cycles.name,
      assessorLabel: assessorLabel(assignment.classification),
      dashboardUrl: `${appUrl}/dashboard?cycle=${assignment.cycle_id}&talent=${assignment.talent_id}`,
    },
  };
}

async function prepareReminder(admin: Admin, appUrl: string, request: EmailRequest): Promise<PrepareResult> {
  const assignment = await loadAssignment(admin, requireId(request.assignmentId));
  if (!assignment) return rejected(404, "The assessment could not be found.");
  if (assignment.status === "submitted") return rejected(409, "This assessment is already submitted.");
  if (assignment.cycles.status !== "open") return rejected(409, "This cycle is not open.");
  return {
    outcome: "ready",
    cycleId: assignment.cycle_id,
    assignmentId: assignment.id,
    data: {
      kind: "reminder",
      recipientName: await loadRecipientName(admin, request.recipientEmail),
      talentName: assignment.talents.profile.full_name,
      cycleName: assignment.cycles.name,
      closesAt: assignment.cycles.closes_at,
      daysLeft: daysUntil(assignment.cycles.closes_at),
      actionUrl: `${appUrl}/`,
    },
  };
}

async function prepareSubmissionConfirmation(
  admin: Admin,
  appUrl: string,
  request: EmailRequest,
): Promise<PrepareResult> {
  const assignment = await loadAssignment(admin, requireId(request.assignmentId));
  if (!assignment) return rejected(404, "The assessment could not be found.");
  if (assignment.status !== "submitted") return rejected(409, "This assessment has not been submitted.");

  const token = randomTokenHex();
  const { error: tokenError } = await admin
    .from("assignments")
    .update({ edit_token_hash: await sha256Hex(token) })
    .eq("id", assignment.id);
  if (tokenError) throw new Error(`Could not save the edit link: ${tokenError.message}`);

  let copyRows: CopyRow[] | null = null;
  if (assignment.copy_requested) {
    const { data, error } = await admin
      .from("responses")
      .select("rating, behaviour_note, competencies(category, name, sort_order)")
      .eq("assignment_id", assignment.id);
    if (error) throw new Error(`Could not load responses: ${error.message}`);
    type ResponseRow = {
      rating: number;
      behaviour_note: string;
      competencies: { category: string; name: string; sort_order: number };
    };
    copyRows = (data as unknown as ResponseRow[])
      .sort((a, b) => a.competencies.sort_order - b.competencies.sort_order)
      .map((row) => ({
        competency: `${row.competencies.category}: ${row.competencies.name}`,
        rating: row.rating,
        note: row.behaviour_note,
      }));
  }

  return {
    outcome: "ready",
    cycleId: assignment.cycle_id,
    assignmentId: assignment.id,
    data: {
      kind: "submission_confirmation",
      recipientName: await loadRecipientName(admin, request.recipientEmail),
      talentName: assignment.talents.profile.full_name,
      cycleName: assignment.cycles.name,
      closesAt: assignment.cycles.closes_at,
      editUrl: `${appUrl}/edit/${token}`,
      copyRows,
    },
  };
}

async function prepareDashboardReady(admin: Admin, appUrl: string, request: EmailRequest): Promise<PrepareResult> {
  const cycleId = requireId(request.cycleId);
  const talentId = requireId(request.talentId);
  const { data: cycle, error: cycleError } = await admin
    .from("cycles")
    .select("name")
    .eq("id", cycleId)
    .maybeSingle();
  if (cycleError) throw new Error(`Could not load cycle: ${cycleError.message}`);
  if (!cycle) return rejected(404, "The cycle could not be found.");

  const { data: talent, error: talentError } = await admin
    .from("talents")
    .select("profile:profiles!profile_id(full_name)")
    .eq("id", talentId)
    .maybeSingle();
  if (talentError) throw new Error(`Could not load talent: ${talentError.message}`);
  if (!talent) return rejected(404, "The talent could not be found.");

  const { data: assignments, error: assignmentsError } = await admin
    .from("assignments")
    .select("status")
    .eq("cycle_id", cycleId)
    .eq("talent_id", talentId);
  if (assignmentsError) throw new Error(`Could not load assessments: ${assignmentsError.message}`);
  if (!assignments || assignments.length === 0) return rejected(409, "No assessments exist for this talent.");
  if (assignments.some((row) => row.status !== "submitted")) {
    return rejected(409, "Not every assessor has submitted yet.");
  }

  return {
    outcome: "ready",
    cycleId,
    assignmentId: null,
    data: {
      kind: "dashboard_ready",
      talentName: (talent.profile as unknown as { full_name: string }).full_name,
      cycleName: cycle.name,
      dashboardUrl: `${appUrl}/dashboard?cycle=${cycleId}&talent=${talentId}`,
    },
  };
}

async function prepareCycleClosed(admin: Admin, appUrl: string, request: EmailRequest): Promise<PrepareResult> {
  const cycleId = requireId(request.cycleId);
  const { data: cycle, error: cycleError } = await admin
    .from("cycles")
    .select("name, closes_at, status")
    .eq("id", cycleId)
    .maybeSingle();
  if (cycleError) throw new Error(`Could not load cycle: ${cycleError.message}`);
  if (!cycle) return rejected(404, "The cycle could not be found.");
  if (cycle.status !== "closed") return rejected(409, "This cycle is still open.");

  const { data: assignments, error: assignmentsError } = await admin
    .from("assignments")
    .select("status")
    .eq("cycle_id", cycleId);
  if (assignmentsError) throw new Error(`Could not load assessments: ${assignmentsError.message}`);

  const counts = { submitted: 0, draft: 0, notStarted: 0 };
  for (const row of assignments ?? []) {
    if (row.status === "submitted") counts.submitted += 1;
    else if (row.status === "draft") counts.draft += 1;
    else counts.notStarted += 1;
  }

  return {
    outcome: "ready",
    cycleId,
    assignmentId: null,
    data: {
      kind: "cycle_closed",
      cycleName: cycle.name,
      closesAt: cycle.closes_at,
      counts,
      dashboardUrl: `${appUrl}/dashboard?cycle=${cycleId}`,
    },
  };
}

async function prepareTemporaryPassword(admin: Admin, appUrl: string, request: EmailRequest): Promise<PrepareResult> {
  if (!request.temporaryPassword) return rejected(400, "A temporary password is required.");
  return {
    outcome: "ready",
    cycleId: null,
    assignmentId: null,
    data: {
      kind: "temporary_password",
      recipientName: await loadRecipientName(admin, request.recipientEmail),
      recipientEmail: request.recipientEmail,
      temporaryPassword: request.temporaryPassword,
      loginUrl: `${appUrl}/`,
    },
  };
}

function prepareAccountActivation(appUrl: string, request: EmailRequest): PrepareResult {
  if (!request.activationCode) return rejected(400, "An activation code is required.");
  return {
    outcome: "ready",
    cycleId: null,
    assignmentId: null,
    data: {
      kind: "account_activation",
      recipientEmail: request.recipientEmail,
      activationCode: request.activationCode,
      activateUrl: `${appUrl}/activate`,
    },
  };
}

async function prepareAccountInvite(admin: Admin, appUrl: string, request: EmailRequest): Promise<PrepareResult> {
  return {
    outcome: "ready",
    cycleId: null,
    assignmentId: null,
    data: {
      kind: "account_invite",
      recipientName: await loadRecipientName(admin, request.recipientEmail),
      recipientEmail: request.recipientEmail,
      activateUrl: `${appUrl}/activate`,
    },
  };
}

function prepareAccountAlreadyActive(appUrl: string, request: EmailRequest): PrepareResult {
  return {
    outcome: "ready",
    cycleId: null,
    assignmentId: null,
    data: {
      kind: "account_already_active",
      recipientEmail: request.recipientEmail,
      loginUrl: `${appUrl}/`,
    },
  };
}

function prepareTalentAdded(appUrl: string, request: EmailRequest): PrepareResult {
  return {
    outcome: "ready",
    cycleId: null,
    assignmentId: null,
    data: {
      kind: "talent_added",
      recipientEmail: request.recipientEmail,
      loginUrl: `${appUrl}/`,
    },
  };
}

function requireId(value: string | null): string {
  if (!value) throw new Error("Missing identifier for this email type.");
  return value;
}

async function prepareTestEmail(admin: Admin, appUrl: string, request: EmailRequest): Promise<PrepareResult> {
  return {
    outcome: "ready",
    cycleId: null,
    assignmentId: null,
    data: {
      kind: "test_email",
      recipientName: await loadRecipientName(admin, request.recipientEmail),
      testedType: request.testedType ?? "test_email",
      checkResult: request.checkResult ?? "Preference check passed: this recipient is set up to receive this email type.",
      senderFrom: request.senderFrom ?? "the default sender",
      loginUrl: `${appUrl}/`,
    },
  };
}

export async function prepareEmail(admin: Admin, appUrl: string, request: EmailRequest): Promise<PrepareResult> {
  switch (request.kind) {
    case "invite":
      return prepareInvite(admin, appUrl, request);
    case "submitted_alert":
      return prepareSubmittedAlert(admin, appUrl, request);
    case "reminder":
      return prepareReminder(admin, appUrl, request);
    case "submission_confirmation":
      return prepareSubmissionConfirmation(admin, appUrl, request);
    case "dashboard_ready":
      return prepareDashboardReady(admin, appUrl, request);
    case "cycle_closed":
      return prepareCycleClosed(admin, appUrl, request);
    case "temporary_password":
      return prepareTemporaryPassword(admin, appUrl, request);
    case "account_activation":
      return prepareAccountActivation(appUrl, request);
    case "account_invite":
      return prepareAccountInvite(admin, appUrl, request);
    case "account_already_active":
      return prepareAccountAlreadyActive(appUrl, request);
    case "talent_added":
      return prepareTalentAdded(appUrl, request);
    case "test_email":
      return prepareTestEmail(admin, appUrl, request);
  }
}
