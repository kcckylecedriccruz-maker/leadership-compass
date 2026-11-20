import type { SupabaseClient } from "npm:@supabase/supabase-js@2.57.4";

export const EMAIL_KINDS = [
  "invite",
  "submitted_alert",
  "reminder",
  "submission_confirmation",
  "dashboard_ready",
  "cycle_closed",
  "temporary_password",
  "account_activation",
  "account_invite",
  "account_already_active",
  "talent_added",
  "test_email",
] as const;

export type EmailKind = (typeof EMAIL_KINDS)[number];

export type CopyRow = {
  competency: string;
  rating: number;
  note: string;
};

export type EmailData =
  | {
      kind: "invite";
      recipientName: string | null;
      recipientEmail: string;
      talentName: string;
      cycleName: string;
      closesAt: string;
      temporaryPassword: string | null;
      loginUrl: string;
    }
  | {
      kind: "submitted_alert";
      recipientName: string | null;
      talentName: string;
      cycleName: string;
      assessorLabel: string | null;
      dashboardUrl: string;
    }
  | {
      kind: "reminder";
      recipientName: string | null;
      talentName: string;
      cycleName: string;
      closesAt: string;
      daysLeft: number;
      actionUrl: string;
    }
  | {
      kind: "submission_confirmation";
      recipientName: string | null;
      talentName: string;
      cycleName: string;
      closesAt: string;
      editUrl: string;
      copyRows: CopyRow[] | null;
    }
  | {
      kind: "dashboard_ready";
      talentName: string;
      cycleName: string;
      dashboardUrl: string;
    }
  | {
      kind: "cycle_closed";
      cycleName: string;
      closesAt: string;
      counts: { submitted: number; draft: number; notStarted: number };
      dashboardUrl: string;
    }
  | {
      kind: "temporary_password";
      recipientName: string | null;
      recipientEmail: string;
      temporaryPassword: string;
      loginUrl: string;
    }
  | {
      kind: "account_activation";
      recipientEmail: string;
      activationCode: string;
      activateUrl: string;
    }
  | {
      kind: "account_invite";
      recipientName: string | null;
      recipientEmail: string;
      activateUrl: string;
    }
  | {
      kind: "account_already_active";
      recipientEmail: string;
      loginUrl: string;
    }
  | {
      kind: "talent_added";
      recipientEmail: string;
      loginUrl: string;
    }
  | {
      kind: "test_email";
      recipientName: string | null;
      testedType: string;
      checkResult: string;
      senderFrom: string;
      loginUrl: string;
    };

export type RenderedEmail = {
  subject: string;
  paragraphs: string[];
  details: [string, string][];
  table: { headers: string[]; rows: string[][] } | null;
  button: { label: string; url: string } | null;
  footer: string[];
  lockedNote: boolean;
  // Filled in by send-email after rendering.
  preferenceLinks?: { settingsUrl: string; unsubscribeUrl: string } | null;
};

const LOCKED_NOTE = "This email is part of your account security and cannot be turned off.";
const WHY_TEXT: Partial<Record<EmailKind, string>> = {
  submitted_alert: "You are receiving this because you administer or manage this talent.",
  reminder: "You are receiving this because you have feedback to give in an open cycle.",
  dashboard_ready: "You are receiving this because you administer or manage this talent.",
  cycle_closed: "You are receiving this because you have an account with Leadership Compass.",
  submission_confirmation: "You are receiving this because you submitted feedback in this cycle.",
};

export function buildPreferenceLinks(
  kind: EmailKind,
  appUrl: string,
  profileId: string | null,
  token: string | null,
): { settingsUrl: string; unsubscribeUrl: string } | null {
  if (!profileId || !token) return null;
  return {
    settingsUrl: `${appUrl}/notifications`,
    unsubscribeUrl: `${appUrl}/unsubscribe?profile_id=${profileId}&email_type=${kind}&token=${token}`,
  };
}

// NS16: admins may reword subject and message but never drop a placeholder.
export function placeholderMap(data: EmailData): Record<string, string> {
  const map: Record<string, string> = {
    email_type: data.kind,
    app_name: APP_TITLE,
  };
  if ("recipientName" in data && data.recipientName) map.first_name = data.recipientName.split(/\s+/)[0];
  if ("recipientEmail" in data) map.email = data.recipientEmail;
  if ("talentName" in data) map.talent_name = data.talentName;
  if ("cycleName" in data) map.cycle_name = data.cycleName;
  if ("closesAt" in data) map.close_date = formatDate(data.closesAt);
  if ("loginUrl" in data) map.login_url = data.loginUrl;
  return map;
}

export async function applyTemplateOverride(
  email: RenderedEmail,
  data: EmailData,
  admin: SupabaseClient,
): Promise<void> {
  const { data: row, error } = await admin
    .from("email_templates")
    .select("subject, message")
    .eq("email_type", data.kind)
    .maybeSingle();
  if (error || !row) return;
  const override = row as { subject: string; message: string };

  const placeholders = placeholderMap(data);
  const substitute = (template: string) =>
    template.replace(/\{(\w+)\}/g, (whole, key: string) => placeholders[key] ?? whole);

  const subject = substitute(override.subject);
  email.subject = subject;

  const bodyLines = override.message.split(/\n+/).map((line) => substitute(line.trim())).filter(Boolean);
  if (bodyLines.length > 0) {
    email.paragraphs = [email.paragraphs[0], ...bodyLines];
  }
}

export function unsubscribeTokenFor(profileId: string, kind: EmailKind, secret: string): Promise<string> {
  return sha256Hex(`${secret}:${profileId}:${kind}`);
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

const APP_TITLE = "Leadership Compass";

function greeting(name: string | null): string {
  return name ? `Hi ${name},` : "Hello,";
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function daysLeftText(daysLeft: number): string {
  if (daysLeft <= 0) return "The close date is today.";
  if (daysLeft === 1) return "You have 1 day left.";
  return `You have ${daysLeft} days left.`;
}

export function renderEmail(data: EmailData): RenderedEmail {
  switch (data.kind) {
    case "invite":
      return {
        subject: `You've been asked to give feedback on ${data.talentName} (${data.cycleName})`,
        paragraphs: [
          greeting(data.recipientName),
          `You've been asked to give feedback on ${data.talentName} as part of the ${APP_TITLE} for ${data.cycleName}.`,
          data.temporaryPassword
            ? "Sign in with the details below. You will be asked to choose a new password the first time you sign in."
            : "Sign in with your existing password to get started.",
        ],
        details: data.temporaryPassword
          ? [
              ["Email", data.recipientEmail],
              ["Temporary password", data.temporaryPassword],
            ]
          : [["Email", data.recipientEmail]],
        table: null,
        button: { label: "Sign in", url: data.loginUrl },
        footer: [`Please complete your feedback by ${formatDate(data.closesAt)}.`],
        lockedNote: true,
      };

    case "account_activation":
      return {
        subject: `Your Leadership Compass activation code: ${data.activationCode}`,
        paragraphs: [
          "Use this 6-digit code to create your password. The code expires in 15 minutes.",
        ],
        details: [["Activation code", data.activationCode]],
        table: null,
        button: { label: "Create your account", url: data.activateUrl },
        footer: ["If you did not ask for this code, you can ignore this email."],
        lockedNote: true,
      };

    case "account_invite":
      return {
        subject: `You're invited to Leadership Compass`,
        paragraphs: [
          greeting(data.recipientName),
          "You've been invited to Leadership Compass. Create your account to get started.",
          "Enter your work email on the next page and we will send you a 6-digit code to set your password.",
        ],
        details: [["Email", data.recipientEmail]],
        table: null,
        button: { label: "Create your account", url: data.activateUrl },
        footer: ["If you were not expecting this invitation, you can ignore this email."],
        lockedNote: true,
      };

    case "account_already_active":
      return {
        subject: "Your Leadership Compass account is already active",
        paragraphs: [
          "Someone asked to create an account with this email, but an account already exists.",
          "You can sign in with your password. If you have forgotten it, use Forgot password on the sign-in page.",
        ],
        details: [["Email", data.recipientEmail]],
        table: null,
        button: { label: "Sign in", url: data.loginUrl },
        footer: ["If you did not ask for this, you can ignore this email."],
        lockedNote: true,
      };

    case "talent_added":
      return {
        subject: "You've been added as a talent in Leadership Compass",
        paragraphs: [
          "You have been added as a talent in Leadership Compass.",
          "Your account has not changed. Sign in with your existing password. Your Self assessment is ready in any open cycle.",
        ],
        details: [["Email", data.recipientEmail]],
        table: null,
        button: { label: "Sign in", url: data.loginUrl },
        footer: ["If you were not expecting this, contact your administrator."],
        lockedNote: true,
      };

    case "temporary_password":
      return {
        subject: "Your temporary password for Leadership Compass",
        paragraphs: [
          greeting(data.recipientName),
          "A temporary password has been set for your account. Sign in with the details below. You will be asked to choose a new password straight away.",
        ],
        details: [
          ["Email", data.recipientEmail],
          ["Temporary password", data.temporaryPassword],
        ],
        table: null,
        button: { label: "Sign in", url: data.loginUrl },
        footer: [
          "This temporary password expires in 24 hours.",
          "If you did not ask for it, contact your administrator.",
        ],
        lockedNote: true,
      };

    case "submitted_alert":
      return {
        subject: `Feedback submitted for ${data.talentName} (${data.cycleName})`,
        paragraphs: [
          `An assessor has submitted their feedback for ${data.talentName} in ${data.cycleName}.`,
        ],
        details: data.assessorLabel ? [["Assessor type", data.assessorLabel]] : [],
        table: null,
        button: { label: "Open dashboard", url: data.dashboardUrl },
        footer: [WHY_TEXT.submitted_alert ?? ""],
        lockedNote: false,
      };

    case "reminder":
      return {
        subject: `Reminder: feedback for ${data.talentName} is due ${formatDate(data.closesAt)}`,
        paragraphs: [
          greeting(data.recipientName),
          `Your feedback for ${data.talentName} in ${data.cycleName} is not submitted yet.`,
          `${daysLeftText(data.daysLeft)} Feedback closes on ${formatDate(data.closesAt)}.`,
        ],
        details: [],
        table: null,
        button: { label: "Continue my feedback", url: data.actionUrl },
        footer: ["Thank you for taking the time to help with this development review.", WHY_TEXT.reminder ?? ""],
        lockedNote: false,
      };

    case "submission_confirmation":
      return {
        subject: `Thank you, your feedback for ${data.talentName} is submitted`,
        paragraphs: [
          greeting(data.recipientName),
          `Thank you. Your feedback for ${data.talentName} in ${data.cycleName} has been submitted.`,
          `You can change your responses until ${formatDate(data.closesAt)} using the button below.`,
        ],
        details: [],
        table: null,
        button: { label: "Edit my responses", url: data.editUrl },
        footer: [
          `The edit link works until ${formatDate(data.closesAt)}. Keep it private, as anyone with the link can change your responses.`,
          WHY_TEXT.submission_confirmation ?? "",
        ],
        lockedNote: false,
      };

    case "dashboard_ready":
      return {
        subject: `All feedback is in for ${data.talentName} (${data.cycleName})`,
        paragraphs: [
          `All assessors have submitted their feedback for ${data.talentName} in ${data.cycleName}.`,
          "The dashboard is ready to view.",
        ],
        details: [],
        table: null,
        button: { label: "Open dashboard", url: data.dashboardUrl },
        footer: [WHY_TEXT.dashboard_ready ?? ""],
        lockedNote: false,
      };

    case "cycle_closed":
      return {
        subject: `${data.cycleName} has closed: where things stand`,
        paragraphs: [
          `${data.cycleName} closed on ${formatDate(data.closesAt)}. Here is where things stand.`,
        ],
        details: [],
        table: {
          headers: ["Status", "Assessments"],
          rows: [
            ["Submitted", String(data.counts.submitted)],
            ["Draft", String(data.counts.draft)],
            ["Not started", String(data.counts.notStarted)],
          ],
        },
        button: { label: "Open dashboard", url: data.dashboardUrl },
        footer: [WHY_TEXT.cycle_closed ?? ""],
        lockedNote: false,
      };

    case "test_email":
      return {
        subject: `[Test] ${data.testedType} from ${APP_TITLE}`,
        paragraphs: [
          greeting(data.recipientName),
          `This is a test email for the "${data.testedType}" email type. It was sent from ${data.senderFrom}.`,
          data.checkResult,
        ],
        details: [],
        table: null,
        button: null,
        footer: ["An administrator sent this test from the notification settings page. Tests are not counted as real emails."],
        lockedNote: false,
      };
  }
}

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}

const STYLE = {
  body: "margin:0;padding:0;background:#f5f7f8;font-family:system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#13212b;",
  paragraph: "margin:0 0 16px;font-size:16px;line-height:1.5;color:#13212b;",
  eyebrow: "margin:0 0 16px;font-size:13px;font-weight:600;color:#005b99;",
  muted: "margin:0;font-size:13px;line-height:1.5;color:#556674;",
  button:
    "display:inline-block;background:#005b99;color:#ffffff;text-decoration:none;font-weight:600;font-size:16px;padding:14px 24px;border-radius:6px;",
};

// Codes and passwords are shown in a box that copies as one exact value (no stray spaces).
const SECRET_LABEL = /password|code/i;
const SECRET_VALUE_STYLE =
  "display:inline-block;font-family:Consolas,Menlo,'Courier New',monospace;font-size:18px;font-weight:700;letter-spacing:1px;color:#003a63;background:#ffffff;border:1px dashed #005b99;border-radius:6px;padding:6px 12px;user-select:all;-webkit-user-select:all;";

function detailsHtml(details: [string, string][]): string {
  const rows = details
    .map(
      ([label, value]) =>
        `<tr><td style="padding:6px 0;font-size:14px;color:#556674;vertical-align:top;width:40%;">${escapeHtml(label)}</td>` +
        (SECRET_LABEL.test(label)
          ? `<td style="padding:6px 0;"><span style="${SECRET_VALUE_STYLE}">${escapeHtml(value)}</span></td></tr>`
          : `<td style="padding:6px 0;font-size:15px;font-weight:600;color:#13212b;word-break:break-all;">${escapeHtml(value)}</td></tr>`),
    )
    .join("");
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eef2f4;border-radius:12px;margin:0 0 24px;"><tr><td style="padding:12px 16px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0">${rows}</table></td></tr></table>`;
}

function tableHtml(table: { headers: string[]; rows: string[][] }): string {
  const head = table.headers
    .map((h) => `<th align="left" style="padding:8px;border-bottom:2px solid #dfe6ea;font-size:13px;color:#556674;">${escapeHtml(h)}</th>`)
    .join("");
  const body = table.rows
    .map(
      (row) =>
        `<tr>${row
          .map((cell) => `<td valign="top" style="padding:10px 8px;border-bottom:1px solid #dfe6ea;font-size:14px;line-height:1.5;">${escapeHtml(cell)}</td>`)
          .join("")}</tr>`,
    )
    .join("");
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin:0 0 24px;"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

export function toHtml(email: RenderedEmail, senderName: string): string {
  const paragraphs = email.paragraphs
    .map((text) => `<p style="${STYLE.paragraph}">${escapeHtml(text)}</p>`)
    .join("");
  const details = email.details.length > 0 ? detailsHtml(email.details) : "";
  const table = email.table ? tableHtml(email.table) : "";
  const button = email.button
    ? `<p style="margin:8px 0 16px;"><a href="${escapeHtml(email.button.url)}" style="${STYLE.button}">${escapeHtml(email.button.label)}</a></p>` +
      `<p style="${STYLE.muted}margin-bottom:24px;">If the button does not work, copy this link into your browser:<br><a href="${escapeHtml(email.button.url)}" style="color:#005b99;word-break:break-all;">${escapeHtml(email.button.url)}</a></p>`
    : "";
  const footer = email.footer.map((text) => `<p style="${STYLE.muted}margin:0 0 8px;">${escapeHtml(text)}</p>`).join("");
  const lockedNote = email.lockedNote ? `<p style="${STYLE.muted}margin:0 0 8px;">${escapeHtml(LOCKED_NOTE)}</p>` : "";
  const preferenceLinks = email.preferenceLinks
    ? `<p style="${STYLE.muted}margin:16px 0 0;border-top:1px solid #dfe6ea;padding-top:16px;"><a href="${escapeHtml(email.preferenceLinks.settingsUrl)}" style="color:#556674;">Manage notifications</a> &middot; <a href="${escapeHtml(email.preferenceLinks.unsubscribeUrl)}" style="color:#556674;">Unsubscribe from these emails</a></p>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(email.subject)}</title>
</head>
<body style="${STYLE.body}">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f5f7f8;">
<tr><td align="center" style="padding:24px 16px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border:1px solid #dfe6ea;border-radius:20px;">
<tr><td style="padding:32px 28px;">
<p style="${STYLE.eyebrow}">${escapeHtml(APP_TITLE)}</p>
${paragraphs}
${details}
${table}
${button}
${footer}
${lockedNote}
<p style="${STYLE.muted}margin:0;border-top:1px solid #dfe6ea;padding-top:16px;">Sent by ${escapeHtml(senderName)} &middot; This message was sent because of your activity in ${escapeHtml(APP_TITLE)}.</p>
${preferenceLinks}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

export function toText(email: RenderedEmail, senderName: string): string {
  const parts: string[] = [email.paragraphs.join("\n\n")];
  if (email.details.length > 0) {
    parts.push(email.details.map(([label, value]) => `${label}: ${value}`).join("\n"));
  }
  if (email.table) {
    const lines = email.table.rows.map((row) => `- ${row.join(" | ")}`);
    parts.push([email.table.headers.join(" | "), ...lines].join("\n"));
  }
  if (email.button) {
    parts.push(`${email.button.label}: ${email.button.url}`);
  }
  if (email.footer.length > 0) {
    parts.push(email.footer.join("\n"));
  }
  if (email.lockedNote) {
    parts.push(LOCKED_NOTE);
  }
  parts.push(`Sent by ${senderName}. This message was sent because of your activity in ${APP_TITLE}.`);
  if (email.preferenceLinks) {
    parts.push(`Manage notifications: ${email.preferenceLinks.settingsUrl}\nUnsubscribe from these emails: ${email.preferenceLinks.unsubscribeUrl}`);
  }
  parts.push(`-- ${APP_TITLE}`);
  return parts.join("\n\n");
}
