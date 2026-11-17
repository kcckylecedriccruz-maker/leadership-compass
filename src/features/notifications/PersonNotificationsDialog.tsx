import { useEffect, useMemo, useState } from 'react';
import { Loader2, RotateCcw, SendHorizontal } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { Notice } from '@/components/Notice';
import {
  LOCKED_EMAIL_TYPES,
  loadPreferences,
  loadReminderHistory,
  relevantEmailTypes,
  resetPersonPreferences,
  sendTestEmail,
  EMAIL_TYPES,
  type HistoryFilter,
  type PreferenceRow,
  type ReminderHistoryRow,
  type TestEmailResult,
} from '@/features/notifications/notificationSettings';

type PersonNotificationsDialogProps = {
  person: { id: string; full_name: string; role: string; manages_talents: boolean; is_talent: boolean; email: string };
  onFinished: () => void;
  onClose: () => void;
};

const TEST_TYPES = [
  ...EMAIL_TYPES.map((item) => ({ key: item.key, title: item.title })),
  { key: 'invite', title: 'Invitation' },
  { key: 'account_activation', title: 'Activation code' },
  { key: 'temporary_password', title: 'Temporary password' },
];

const RESULT_FILTERS: { key: HistoryFilter; title: string }[] = [
  { key: 'all', title: 'All' },
  { key: 'sent', title: 'Sent' },
  { key: 'skipped', title: 'Skipped' },
  { key: 'failed', title: 'Failed' },
];

function resultLabel(row: ReminderHistoryRow): { text: string; className: string } {
  if (row.status === 'sent') return { text: 'Sent', className: 'font-semibold text-primary' };
  if (row.status === 'skipped_by_preference') return { text: 'Skipped by preference', className: 'font-semibold text-ink-muted' };
  return { text: `Failed${row.error ? `: ${row.error}` : ''}`, className: 'font-semibold text-danger' };
}

export function PersonNotificationsDialog({ person, onFinished, onClose }: PersonNotificationsDialogProps) {
  const [rows, setRows] = useState<PreferenceRow[] | null>(null);
  const [history, setHistory] = useState<ReminderHistoryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [resetDone, setResetDone] = useState(false);
  const [sendingTest, setSendingTest] = useState(false);
  const [testType, setTestType] = useState('submission_confirmation');
  const [testResult, setTestResult] = useState<TestEmailResult | null>(null);

  const [cycleFilter, setCycleFilter] = useState('all');
  const [resultFilter, setResultFilter] = useState<HistoryFilter>('all');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const prefs = await loadPreferences(person.id);
        if (!cancelled) setRows(prefs);
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Could not load settings.');
      }
    })();
    void (async () => {
      try {
        const historyRows = await loadReminderHistory(person.email);
        if (!cancelled) setHistory(historyRows);
      } catch {
        if (!cancelled) setHistory([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [person.id, person.email]);

  const cycles = useMemo(() => {
    const names = new Set<string>();
    for (const row of history ?? []) {
      if (row.cycle_name) names.add(row.cycle_name);
    }
    return Array.from(names).sort();
  }, [history]);

  const filteredHistory = useMemo(() => {
    return (history ?? []).filter((row) => {
      if (cycleFilter !== 'all' && row.cycle_name !== cycleFilter) return false;
      if (resultFilter === 'sent' && row.status !== 'sent') return false;
      if (resultFilter === 'skipped' && row.status !== 'skipped_by_preference') return false;
      if (resultFilter === 'failed' && row.status !== 'failed') return false;
      return true;
    });
  }, [history, cycleFilter, resultFilter]);

  async function handleReset() {
    setResetting(true);
    setError(null);
    try {
      await resetPersonPreferences(person.id);
      setRows([]);
      setResetDone(true);
      onFinished();
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : 'Could not reset settings.');
    } finally {
      setResetting(false);
    }
  }

  async function handleSendTest() {
    setSendingTest(true);
    setError(null);
    setTestResult(null);
    try {
      const result = await sendTestEmail({ recipientEmail: person.email, emailType: testType });
      setTestResult(result);
    } catch (testError) {
      setError(testError instanceof Error ? testError.message : 'The test email could not be sent.');
    } finally {
      setSendingTest(false);
    }
  }

  const visible = relevantEmailTypes(person.role as never, person.manages_talents, person.is_talent);

  return (
    <Modal
      title={`Notification settings: ${person.full_name}`}
      description="Overrides this person has saved. Resetting removes all their choices and returns everything to the defaults."
      onClose={onClose}
    >
      <div className="space-y-4">
        {error && <Notice>{error}</Notice>}
        {!rows && !error && <p className="text-sm text-ink-muted">Loading settings...</p>}
        {rows && (
          <ul className="space-y-2">
            {LOCKED_EMAIL_TYPES.map((item) => (
              <li key={item.key} className="flex items-center justify-between gap-3 rounded-xl bg-muted px-4 py-3 text-sm">
                <span className="font-semibold">{item.title}</span>
                <span className="text-ink-muted">Always on</span>
              </li>
            ))}
            {visible.map((meta) => {
              const row = rows.find((item) => item.email_type === meta.key);
              const enabled = row ? row.enabled : true;
              return (
                <li key={meta.key} className="flex items-center justify-between gap-3 rounded-xl bg-muted px-4 py-3 text-sm">
                  <span className="font-semibold">{meta.title}</span>
                  <span className={enabled ? 'text-ink' : 'text-ink-muted'}>
                    {enabled ? (row?.delivery === 'daily_digest' ? 'Daily digest' : 'On') : 'Off'}
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        {history !== null && (
          <div className="space-y-2">
            <p className="text-sm font-semibold">Reminder email history</p>
            {history.length > 0 && (
              <div className="flex flex-wrap gap-2">
                <label className="sr-only" htmlFor="history-cycle-filter">Filter by cycle</label>
                <select
                  id="history-cycle-filter"
                  className="field-input max-w-48 text-sm"
                  value={cycleFilter}
                  onChange={(event) => setCycleFilter(event.target.value)}
                >
                  <option value="all">All cycles</option>
                  {cycles.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
                <div role="group" aria-label="Filter by result" className="flex gap-1">
                  {RESULT_FILTERS.map((filter) => (
                    <button
                      key={filter.key}
                      type="button"
                      aria-pressed={resultFilter === filter.key}
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${
                        resultFilter === filter.key ? 'bg-primary text-on-primary' : 'bg-muted text-ink-muted'
                      }`}
                      onClick={() => setResultFilter(filter.key)}
                    >
                      {filter.title}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {filteredHistory.length === 0 ? (
              <p className="text-sm text-ink-muted">No reminder emails yet.</p>
            ) : (
              <div className="max-h-56 overflow-y-auto rounded-xl border border-line">
                <table className="w-full text-left text-sm">
                  <thead className="bg-muted text-xs uppercase tracking-wide text-ink-muted">
                    <tr>
                      <th scope="col" className="px-3 py-2">When</th>
                      <th scope="col" className="px-3 py-2">Cycle</th>
                      <th scope="col" className="px-3 py-2">Talent</th>
                      <th scope="col" className="px-3 py-2">Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredHistory.map((row, index) => {
                      const when = row.sent_at ?? row.created_at;
                      const result = resultLabel(row);
                      return (
                        <tr key={`${row.created_at ?? 'row'}-${index}`} className="border-t border-line">
                          <td className="px-3 py-2 text-ink-muted">{when ? new Date(when).toLocaleString() : 'Unknown time'}</td>
                          <td className="px-3 py-2">{row.cycle_name ?? '—'}</td>
                          <td className="px-3 py-2">{row.talent_name ?? '—'}</td>
                          <td className={`px-3 py-2 ${result.className}`}>{result.text}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        <div className="space-y-2 rounded-xl bg-muted p-3">
          <p className="text-sm font-semibold">Send a test email</p>
          <p className="text-xs text-ink-muted">
            Runs the same preference check as a real send. Tests are marked as tests and never count toward reminders or alerts.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="test-type">Email type</label>
            <select
              id="test-type"
              className="field-input max-w-56 text-sm"
              value={testType}
              onChange={(event) => setTestType(event.target.value)}
            >
              {TEST_TYPES.map((item) => (
                <option key={item.key} value={item.key}>{item.title}</option>
              ))}
            </select>
            <button type="button" className="btn-secondary" onClick={() => void handleSendTest()} disabled={sendingTest}>
              {sendingTest ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <SendHorizontal className="h-4 w-4" aria-hidden="true" />
              )}
              Send test
            </button>
          </div>
          {testResult?.status === 'sent' && (
            <p className="text-sm font-semibold text-primary" role="status">
              Sent to {person.email} from {testResult.sender || 'the default sender'}.
            </p>
          )}
          {testResult?.status === 'skipped' && (
            <p className="text-sm font-semibold text-ink-muted" role="status">
              Skipped by preference: {testResult.reason}
            </p>
          )}
          {testResult?.status === 'failed' && (
            <Notice>Failed: {testResult.error}</Notice>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Close
          </button>
          <button type="button" className="btn-primary" onClick={() => void handleReset()} disabled={resetting || !rows}>
            {resetting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RotateCcw className="h-4 w-4" aria-hidden="true" />}
            Reset to defaults
          </button>
        </div>
        {resetDone && <p className="text-sm font-semibold text-primary" role="status">Settings were reset to the defaults.</p>}
      </div>
    </Modal>
  );
}
