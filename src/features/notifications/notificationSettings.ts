import { supabase } from '@/lib/supabase';
import type { Profile, Role } from '@/lib/types';

export type EmailTypeKey = 'submission_confirmation' | 'cycle_closed' | 'reminder' | 'submitted_alert' | 'dashboard_ready';

export type EmailTypeMeta = {
  key: EmailTypeKey;
  title: string;
  description: string;
  audience: 'member' | 'admin';
  hasDelivery: boolean;
};

export const EMAIL_TYPES: EmailTypeMeta[] = [
  {
    key: 'submission_confirmation',
    title: 'Submission confirmation',
    description: 'A confirmation email after you submit feedback.',
    audience: 'member',
    hasDelivery: false,
  },
  {
    key: 'cycle_closed',
    title: 'Cycle closed summary',
    description: 'A summary email when an assessment cycle closes.',
    audience: 'member',
    hasDelivery: false,
  },
  {
    key: 'reminder',
    title: 'Feedback reminders',
    description: 'Reminders while your feedback is not yet submitted.',
    audience: 'member',
    hasDelivery: false,
  },
  {
    key: 'submitted_alert',
    title: 'Submission alerts',
    description: 'An alert each time an assessor submits feedback for a talent.',
    audience: 'admin',
    hasDelivery: true,
  },
  {
    key: 'dashboard_ready',
    title: 'Dashboard ready',
    description: 'A notice when all feedback is in for a talent.',
    audience: 'admin',
    hasDelivery: false,
  },
];

export const LOCKED_EMAIL_TYPES = [
  { key: 'invite', title: 'Invitations', reason: 'Needed to access your account' },
  { key: 'account_activation', title: 'Activation codes', reason: 'Needed to access your account' },
  { key: 'temporary_password', title: 'Temporary passwords', reason: 'Needed to access your account' },
] as const;

export function relevantEmailTypes(role: Role, managesTalents: boolean, isTalent: boolean): EmailTypeMeta[] {
  // Everyone is an assessor, so everyone gets the member emails; admins and managers also get the oversight ones.
  if (role === 'admin' || managesTalents) return [...EMAIL_TYPES];
  void isTalent;
  return EMAIL_TYPES.filter((item) => item.audience === 'member');
}

export type PreferenceRow = {
  email_type: string;
  enabled: boolean;
  delivery: 'instant' | 'daily_digest';
};

export async function loadPreferences(profileId: string): Promise<PreferenceRow[]> {
  const { data, error } = await supabase
    .from('notification_preferences')
    .select('email_type, enabled, delivery')
    .eq('profile_id', profileId);
  if (error) throw new Error(error.message);
  return (data ?? []) as PreferenceRow[];
}

async function authenticatedHeaders(): Promise<HeadersInit> {
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  if (!accessToken) throw new Error('Your session has expired. Please sign in again.');
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };
}

export async function savePreference(input: {
  emailType: string;
  enabled: boolean;
  delivery?: 'instant' | 'daily_digest';
}): Promise<void> {
  const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/update-notification-settings`, {
    method: 'POST',
    headers: await authenticatedHeaders(),
    body: JSON.stringify({
      email_type: input.emailType,
      enabled: input.enabled,
      delivery: input.delivery ?? 'instant',
    }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? 'Could not save your notification settings.');
  }
}

export async function hasOpenSubmissions(profileId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('assignments')
    .select('id, cycles!inner(status)')
    .eq('assessor_id', profileId)
    .neq('status', 'submitted')
    .eq('cycles.status', 'open');
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

export function isReminderLocked(profile: Profile, openSubmissions: boolean): boolean {
  return openSubmissions;
}

export async function resetPersonPreferences(profileId: string): Promise<void> {
  const { error } = await supabase.from('notification_preferences').delete().eq('profile_id', profileId);
  if (error) throw new Error(error.message);
}

export type ReminderHistoryRow = {
  type: string;
  status: string;
  created_at: string | null;
  sent_at: string | null;
  error: string | null;
  cycle_name: string | null;
  talent_name: string | null;
};

export type HistoryFilter = 'all' | 'sent' | 'skipped' | 'failed';

// NS9: real reminder sends only (test sends carry is_test and are excluded).
export async function loadReminderHistory(recipientEmail: string): Promise<ReminderHistoryRow[]> {
  const { data, error } = await supabase
    .from('notifications')
    .select(
      'type, status, created_at, sent_at, error, cycles(name), assignments(talents(profile:profiles!profile_id(full_name)))',
    )
    .eq('recipient_email', recipientEmail)
    .eq('type', 'reminder')
    .eq('is_test', false)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as ReminderHistoryQueryRow[]).map((row) => ({
    type: row.type,
    status: row.status,
    created_at: row.created_at,
    sent_at: row.sent_at,
    error: row.error,
    cycle_name: row.cycles?.name ?? null,
    talent_name: row.assignments?.talents?.profile?.full_name ?? null,
  }));
}

type ReminderHistoryQueryRow = {
  type: string;
  status: string;
  created_at: string | null;
  sent_at: string | null;
  error: string | null;
  cycles: { name: string } | null;
  assignments: { talents: { profile: { full_name: string } } | null } | null;
};

export type TestEmailResult =
  | { status: 'sent'; sender: string }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; error: string };

export async function sendTestEmail(input: {
  recipientEmail: string;
  emailType: string;
}): Promise<TestEmailResult> {
  const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-test-email`, {
    method: 'POST',
    headers: await authenticatedHeaders(),
    body: JSON.stringify({ recipient_email: input.recipientEmail, email_type: input.emailType }),
  });
  const body = (await response.json().catch(() => null)) as
    | { status?: string; reason?: string; error?: string; sender?: string }
    | null;
  if (!response.ok) {
    throw new Error(body?.error ?? 'The test email could not be sent.');
  }
  if (body?.status === 'skipped') return { status: 'skipped', reason: body.reason ?? 'Skipped by preference.' };
  if (body?.status === 'failed') return { status: 'failed', error: body.error ?? 'The test email could not be sent.' };
  return { status: 'sent', sender: body?.sender ?? '' };
}

export type AppSettingsRow = {
  sender_name: string | null;
  sender_email: string | null;
  reply_to_email: string | null;
  sender_domain_status: 'verified' | 'pending' | 'not_set_up';
  sender_verified_at: string | null;
  updated_at: string | null;
  email_provider: 'gmail' | 'resend';
  gmail_account: string | null;
  gmail_connected_at: string | null;
  gmail_status: 'connected' | 'reconnect_needed' | 'failed' | 'not_connected';
  gmail_status_error: string | null;
};

export async function loadAppSettings(): Promise<AppSettingsRow | null> {
  const { data, error } = await supabase.from('app_settings').select('*').eq('id', 1).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as AppSettingsRow | null) ?? null;
}

export async function saveSenderSettings(input: {
  senderName: string;
  senderEmail: string;
  replyToEmail: string;
  emailProvider: 'gmail' | 'resend';
  confirmedTestReceived: boolean;
  disconnectGmail?: boolean;
}): Promise<void> {
  const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/update-sender-settings`, {
    method: 'POST',
    headers: await authenticatedHeaders(),
    body: JSON.stringify({
      sender_name: input.senderName,
      sender_email: input.senderEmail,
      reply_to_email: input.replyToEmail,
      email_provider: input.emailProvider,
      confirmed_test_received: input.confirmedTestReceived,
      disconnect_gmail: input.disconnectGmail === true,
    }),
  });
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  if (!response.ok) throw new Error(body?.error ?? 'Could not save the sender settings.');
}

export type GmailCheckResult = {
  status: 'connected' | 'reconnect_needed' | 'failed' | 'not_connected';
  error?: string;
};

// NS19: returns the Google consent URL to open in a new tab.
export async function connectGmail(): Promise<string> {
  const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/connect-gmail`, {
    method: 'POST',
    headers: await authenticatedHeaders(),
  });
  const body = (await response.json().catch(() => null)) as { consent_url?: string; error?: string } | null;
  if (!response.ok || !body?.consent_url) {
    throw new Error(body?.error ?? 'Could not start the Gmail connection.');
  }
  return body.consent_url;
}

export async function checkGmailConnection(): Promise<GmailCheckResult> {
  const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/check-gmail-connection`, {
    method: 'POST',
    headers: await authenticatedHeaders(),
  });
  const body = (await response.json().catch(() => null)) as GmailCheckResult | { error?: string } | null;
  if (!response.ok) throw new Error((body as { error?: string })?.error ?? 'Could not check the connection.');
  return body as GmailCheckResult;
}

export type TemplateOverrideRow = { email_type: string; subject: string; message: string; updated_at: string | null };

export async function loadTemplateOverrides(): Promise<TemplateOverrideRow[]> {
  const { data, error } = await supabase.from('email_templates').select('email_type, subject, message, updated_at');
  if (error) throw new Error(error.message);
  return (data ?? []) as TemplateOverrideRow[];
}

export async function saveTemplateOverride(input: {
  emailType: string;
  subject: string;
  message: string;
}): Promise<void> {
  const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/update-notification-settings`, {
    method: 'POST',
    headers: await authenticatedHeaders(),
    body: JSON.stringify({ template: input }),
  });
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  if (!response.ok) throw new Error(body?.error ?? 'Could not save the template.');
}
