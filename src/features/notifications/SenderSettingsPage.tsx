import { useEffect, useState } from 'react';
import { Loader2, Save, Send } from 'lucide-react';
import { Notice } from '@/components/Notice';
import {
  EMAIL_TYPES,
  checkGmailConnection,
  connectGmail,
  loadAppSettings,
  loadTemplateOverrides,
  saveSenderSettings,
  saveTemplateOverride,
  sendTestEmail,
  type AppSettingsRow,
  type GmailCheckResult,
  type TemplateOverrideRow,
} from '@/features/notifications/notificationSettings';

type EmailProvider = 'gmail' | 'resend';

const PROVIDER_LABELS: Record<EmailProvider, string> = {
  gmail: 'Gmail',
  resend: 'Resend',
};

const GMAIL_STATUS_TEXT: Record<AppSettingsRow['gmail_status'], (account: string | null) => string> = {
  connected: (account) => (account ? `Connected as ${account}` : 'Connected'),
  reconnect_needed: () => 'Reconnect needed',
  failed: () => 'Failed',
  not_connected: () => 'Not connected',
};

const PLACEHOLDER_HELP: Record<string, string> = {
  invite: '{first_name}, {talent_name}, {cycle_name}, {close_date}',
  submitted_alert: '{talent_name}, {cycle_name}',
  reminder: '{first_name}, {talent_name}, {cycle_name}, {close_date}',
  submission_confirmation: '{first_name}, {talent_name}, {cycle_name}, {close_date}',
  dashboard_ready: '{talent_name}, {cycle_name}',
  cycle_closed: '{cycle_name}, {close_date}',
};

export function SenderSettingsPage({
  gmailResult,
  readOnly = false,
}: { gmailResult?: 'connected' | 'failed' | null; readOnly?: boolean } = {}) {
  const [settings, setSettings] = useState<AppSettingsRow | null>(null);
  const [provider, setProvider] = useState<EmailProvider>('gmail');
  const [savedProvider, setSavedProvider] = useState<EmailProvider | null>(null);
  const [senderName, setSenderName] = useState('');
  const [senderEmail, setSenderEmail] = useState('');
  const [replyToEmail, setReplyToEmail] = useState('');
  const [testReceived, setTestReceived] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [connecting, setConnecting] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<GmailCheckResult | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [testing, setTesting] = useState(false);

  const [templates, setTemplates] = useState<TemplateOverrideRow[]>([]);
  const [editingType, setEditingType] = useState<string>(EMAIL_TYPES[0].key);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [templateSaved, setTemplateSaved] = useState(false);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [savingTemplate, setSavingTemplate] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [row, overrides] = await Promise.all([loadAppSettings(), loadTemplateOverrides()]);
        if (cancelled) return;
        setSettings(row);
        if (row) {
          setProvider(row.email_provider);
          setSavedProvider(row.email_provider);
          setSenderName(row.sender_name ?? '');
          setSenderEmail(row.sender_email ?? '');
          setReplyToEmail(row.reply_to_email ?? '');
        }
        setTemplates(overrides);
        const first = overrides.find((item) => item.email_type === EMAIL_TYPES[0].key);
        if (first) {
          setSubject(first.subject);
          setMessage(first.message);
        }
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Could not load settings.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // The Google approval happens on Google's site; refresh the status when the
  // admin comes back to this tab.
  useEffect(() => {
    function refresh() {
      void loadAppSettings()
        .then((row) => setSettings(row))
        .catch(() => undefined);
    }
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, []);

  function pickTemplate(key: string) {
    setEditingType(key);
    setTemplateSaved(false);
    setTemplateError(null);
    const override = templates.find((item) => item.email_type === key);
    setSubject(override?.subject ?? '');
    setMessage(override?.message ?? '');
  }

  const providerChanged = savedProvider !== null && provider !== savedProvider;
  const addressChanged = settings?.sender_email != null && senderEmail !== settings.sender_email;
  const gmailConnected = Boolean(settings?.gmail_account) && settings?.gmail_status !== 'not_connected';
  // Gmail that isn't connected yet is proven by connecting, not by a test email.
  const needsTestConfirmation = (providerChanged || addressChanged) && !(provider === 'gmail' && !gmailConnected);
  const senderSaved = Boolean(settings?.sender_email) && senderEmail.trim().toLowerCase() === (settings?.sender_email ?? '').toLowerCase();
  const gmailMismatch =
    provider === 'gmail' && gmailConnected && settings?.gmail_account != null &&
    senderEmail.trim().toLowerCase() !== settings.gmail_account.toLowerCase();
  const canSaveSender =
    senderName.trim() !== '' && senderEmail.trim() !== '' && (!needsTestConfirmation || testReceived) && !gmailMismatch && !saving;

  async function handleConnectGmail() {
    setConnecting(true);
    setError(null);
    try {
      // Same tab: Google sends the browser back to Sender settings when done.
      window.location.assign(await connectGmail());
    } catch (connectError) {
      setError(connectError instanceof Error ? connectError.message : 'Could not start the Gmail connection.');
      setConnecting(false);
    }
  }

  async function handleCheckConnection() {
    setChecking(true);
    setCheckResult(null);
    setError(null);
    try {
      const result = await checkGmailConnection();
      setCheckResult(result);
      setSettings(await loadAppSettings());
    } catch (checkError) {
      setError(checkError instanceof Error ? checkError.message : 'Could not check the connection.');
    } finally {
      setChecking(false);
    }
  }

  async function handleSendTestEmail() {
    setTesting(true);
    setError(null);
    try {
      await sendTestEmail({ recipientEmail: senderEmail, emailType: 'submission_confirmation' });
      setCheckResult({ status: 'connected' });
    } catch (testError) {
      setCheckResult({ status: 'failed', error: testError instanceof Error ? testError.message : 'The test email could not be sent.' });
    } finally {
      setTesting(false);
    }
  }

  async function handleDisconnect() {
    setDisconnecting(true);
    setError(null);
    try {
      await saveSenderSettings({
        senderName,
        senderEmail,
        replyToEmail,
        emailProvider: provider,
        confirmedTestReceived: true,
        disconnectGmail: true,
      });
      setSettings(await loadAppSettings());
      setCheckResult(null);
    } catch (disconnectError) {
      setError(disconnectError instanceof Error ? disconnectError.message : 'Could not disconnect Gmail.');
    } finally {
      setDisconnecting(false);
    }
  }

  async function handleSaveSender() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await saveSenderSettings({
        senderName,
        senderEmail,
        replyToEmail,
        emailProvider: provider,
        confirmedTestReceived: testReceived,
      });
      setSaved(true);
      setSettings(await loadAppSettings());
      setSavedProvider(provider);
      setTestReceived(false);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save the sender settings.');
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveTemplate() {
    setSavingTemplate(true);
    setTemplateError(null);
    setTemplateSaved(false);
    try {
      await saveTemplateOverride({ emailType: editingType, subject, message });
      const updated = templates.filter((item) => item.email_type !== editingType);
      setTemplates([...updated, { email_type: editingType, subject, message, updated_at: new Date().toISOString() }]);
      setTemplateSaved(true);
    } catch (saveError) {
      setTemplateError(saveError instanceof Error ? saveError.message : 'Could not save the template.');
    } finally {
      setSavingTemplate(false);
    }
  }

  const meta = EMAIL_TYPES.find((item) => item.key === editingType);
  const overridden = templates.some((item) => item.email_type === editingType);
  const gmailStatus = settings?.gmail_status ?? 'not_connected';
  const statusLabel = GMAIL_STATUS_TEXT[gmailStatus](settings?.gmail_account ?? null);

  return (
    // View-only Settings access: every control is shown but disabled.
    <fieldset disabled={readOnly} className="min-w-0 space-y-8">
      {readOnly && <Notice tone="info">You have view-only access to Settings.</Notice>}
      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-bold">Sender settings</h2>
          <p className="text-sm text-ink-muted">
            The provider emails are sent from, plus the name and address they appear to come from.
          </p>
        </div>
        {error && <Notice>{error}</Notice>}
        <div className="space-y-4 rounded-2xl border border-line bg-surface p-5">
          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold">Email provider</legend>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(PROVIDER_LABELS) as EmailProvider[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={provider === key}
                  onClick={() => setProvider(key)}
                  className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors duration-200 ${
                    provider === key ? 'bg-primary text-on-primary' : 'bg-muted text-ink-muted hover:text-ink'
                  }`}
                >
                  {PROVIDER_LABELS[key]}
                  {key === 'gmail' ? ' (default)' : ''}
                </button>
              ))}
            </div>
            <p className="text-xs text-ink-muted">
              Switching provider needs a received test email before it can be saved.
            </p>
          </fieldset>

          {provider === 'gmail' && (
            <div className="space-y-3 rounded-xl bg-muted p-4">
              <p className="text-sm font-semibold">Gmail</p>
              <ol className="list-decimal space-y-1 pl-5 text-xs text-ink-muted">
                <li className={senderSaved ? 'text-primary' : undefined}>
                  Enter the Gmail address emails should come from as the <strong>Sender email</strong> below, then save.
                </li>
                <li className={gmailConnected ? 'text-primary' : undefined}>
                  Select <strong>Connect Gmail</strong> and approve on Google&apos;s screen while signed in as that address.
                </li>
                <li className={settings?.gmail_status === 'connected' ? 'text-primary' : undefined}>
                  Select <strong>Check connection</strong>; a test email arrives in your inbox.
                </li>
              </ol>
              <p className="text-xs text-ink-muted">
                <strong>Quicker option, Gmail SMTP:</strong> set <code>GMAIL_SMTP_USER</code> and <code>GMAIL_SMTP_APP_PASSWORD</code> (a Google App password) in Supabase Edge Function secrets, then select <strong>Check connection</strong>. No Google Cloud setup or Connect Gmail step is needed.
              </p>
              {gmailResult === 'connected' && settings?.gmail_status === 'connected' && (
                <p className="text-xs font-semibold text-primary" role="status">
                  Gmail connected as {settings.gmail_account}. Run Check connection to send a test email.
                </p>
              )}
              {gmailMismatch && (
                <p className="text-xs text-danger">
                  Gmail is connected as {settings?.gmail_account}. Emails can only come from that address: disconnect first to use another one.
                </p>
              )}
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => void handleConnectGmail()}
                  disabled={connecting || !senderSaved}
                  title={senderSaved ? undefined : 'Save the sender email first'}
                >
                  {connecting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                  {gmailStatus === 'connected' || gmailStatus === 'reconnect_needed' ? 'Reconnect Gmail' : 'Connect Gmail'}
                </button>
                <button type="button" className="btn-secondary" onClick={() => void handleCheckConnection()} disabled={checking}>
                  {checking ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                  Check connection
                </button>
                <button type="button" className="btn-secondary" onClick={() => void handleDisconnect()} disabled={disconnecting || gmailStatus === 'not_connected'}>
                  {disconnecting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                  Disconnect
                </button>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${
                    gmailStatus === 'connected' ? 'bg-primary/10 text-primary' : gmailStatus === 'not_connected' ? 'bg-surface text-ink-muted' : 'bg-danger/10 text-danger'
                  }`}
                >
                  {statusLabel}
                </span>
              </div>
              {gmailStatus === 'failed' && settings?.gmail_status_error && (
                <p className="text-xs text-danger">Failed: {settings.gmail_status_error}</p>
              )}
              {gmailStatus === 'reconnect_needed' && (
                <p className="text-xs text-danger">The Gmail approval expired. Reconnect Gmail to keep sending.</p>
              )}
              {(checkResult?.error || checkResult?.status === 'connected') && (
                <p className={`text-xs font-semibold ${checkResult.status === 'connected' ? 'text-primary' : 'text-danger'}`} role="status">
                  {checkResult.status === 'connected'
                    ? 'Connected. A test email is on its way to your inbox.'
                    : checkResult.error}
                </p>
              )}
              <button type="button" className="btn-secondary" onClick={() => void handleSendTestEmail()} disabled={testing}>
                {testing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
                Send test email
              </button>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-semibold">
              Sender name
              <input className="field-input mt-1 w-full" value={senderName} onChange={(event) => setSenderName(event.target.value)} maxLength={100} />
            </label>
            <label className="text-sm font-semibold">
              Sender email
              <input
                className="field-input mt-1 w-full"
                type="email"
                value={senderEmail}
                onChange={(event) => setSenderEmail(event.target.value)}
                maxLength={254}
              />
            </label>
            <label className="text-sm font-semibold sm:col-span-2">
              Reply-to email (optional)
              <input
                className="field-input mt-1 w-full"
                type="email"
                value={replyToEmail}
                onChange={(event) => setReplyToEmail(event.target.value)}
                maxLength={254}
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setCheckResult(null);
                setError(
                  provider === 'gmail'
                    ? 'Use "Check connection" above — it sends a test email from the Gmail account to your inbox. Tick the box once it arrives.'
                    : 'Send a test email from the new address to your own inbox via your email service, then tick the box once it arrives.',
                );
              }}
            >
              <Send className="h-4 w-4" aria-hidden="true" />
              How do I test?
            </button>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={testReceived} onChange={(event) => setTestReceived(event.target.checked)} />
              I received a test email from the new address
            </label>
          </div>
          {needsTestConfirmation && !testReceived && (
            <p className="text-xs text-ink-muted">
              A provider switch or new sender address needs a received test email before saving.
            </p>
          )}
          <div>
            <button type="button" className="btn-primary" onClick={() => void handleSaveSender()} disabled={!canSaveSender}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
              Save sender settings
            </button>
            {saved && <span className="ml-3 text-sm font-semibold text-primary" role="status">Saved.</span>}
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-bold">Email templates</h2>
          <p className="text-sm text-ink-muted">
            Reword the subject and message. Placeholders in braces, the action button, and the footer cannot be removed.
          </p>
        </div>
        {templateError && <Notice>{templateError}</Notice>}
        <div className="space-y-4 rounded-2xl border border-line bg-surface p-5">
          <label className="text-sm font-semibold">
            Email type
            <select className="field-input mt-1 w-full" value={editingType} onChange={(event) => pickTemplate(event.target.value)}>
              {EMAIL_TYPES.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.title}
                  {templates.some((row) => row.email_type === item.key) ? ' (edited)' : ''}
                </option>
              ))}
            </select>
          </label>
          <p className="text-xs text-ink-muted">Available placeholders: {PLACEHOLDER_HELP[editingType] ?? '{first_name}'}</p>
          <label className="block text-sm font-semibold">
            Subject
            <input className="field-input mt-1 w-full" value={subject} onChange={(event) => setSubject(event.target.value)} maxLength={300} />
          </label>
          <label className="block text-sm font-semibold">
            Message
            <textarea
              className="field-input mt-1 w-full"
              rows={4}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              maxLength={5000}
            />
          </label>
          <p className="text-xs text-ink-muted">
            {meta ? meta.description : ''} Keep at least one placeholder so each recipient still gets their own details.
          </p>
          <button
            type="button"
            className="btn-primary"
            onClick={() => void handleSaveTemplate()}
            disabled={savingTemplate || !subject.includes('{') || !message.includes('{')}
          >
            {savingTemplate ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
            {overridden ? 'Save changes' : 'Save as custom wording'}
          </button>
          {templateSaved && <span className="ml-3 text-sm font-semibold text-primary" role="status">Template saved.</span>}
        </div>
      </section>
    </fieldset>
  );
}
