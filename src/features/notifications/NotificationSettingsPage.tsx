import { useEffect, useState } from 'react';
import { Bell, BellOff, Check, Loader2, Settings2 } from 'lucide-react';
import { Notice } from '@/components/Notice';
import type { Profile } from '@/lib/types';
import {
  LOCKED_EMAIL_TYPES,
  hasOpenSubmissions,
  loadPreferences,
  relevantEmailTypes,
  savePreference,
  type EmailTypeMeta,
  type PreferenceRow,
} from '@/features/notifications/notificationSettings';

type ToggleState = { enabled: boolean; delivery: 'instant' | 'daily_digest' };

function prefFor(rows: PreferenceRow[], key: string): ToggleState | null {
  const row = rows.find((item) => item.email_type === key);
  if (!row) return null;
  return { enabled: row.enabled, delivery: row.delivery };
}

export function NotificationSettingsPage({
  profile,
  onOpenSenderSettings,
}: {
  profile: Profile;
  onOpenSenderSettings?: () => void;
}) {
  const [rows, setRows] = useState<PreferenceRow[] | null>(null);
  const [openSubmissions, setOpenSubmissions] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const visible = relevantEmailTypes(profile.role, profile.manages_talents, profile.is_talent);
  const needsReminderCheck = visible.some((item) => item.key === 'reminder');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const prefs = await loadPreferences(profile.id);
        const open = needsReminderCheck ? await hasOpenSubmissions(profile.id) : false;
        if (cancelled) return;
        setRows(prefs);
        setOpenSubmissions(open);
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Could not load settings.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [needsReminderCheck, profile.id]);

  async function toggle(meta: EmailTypeMeta, current: ToggleState) {
    if (meta.key === 'reminder' && current.enabled && openSubmissions) return;
    setSavingKey(meta.key);
    setError(null);
    try {
      await savePreference({ emailType: meta.key, enabled: !current.enabled, delivery: current.delivery });
      setRows((prev) => {
        const base = prev ?? [];
        const existing = base.find((item) => item.email_type === meta.key);
        if (existing) {
          return base.map((item) =>
            item.email_type === meta.key ? { ...item, enabled: !current.enabled } : item,
          );
        }
        return [...base, { email_type: meta.key, enabled: !current.enabled, delivery: current.delivery }];
      });
      setSavedKey(meta.key);
      window.setTimeout(() => setSavedKey((key) => (key === meta.key ? null : key)), 2000);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save your notification settings.');
    } finally {
      setSavingKey(null);
    }
  }

  async function setDelivery(meta: EmailTypeMeta, current: ToggleState, delivery: 'instant' | 'daily_digest') {
    if (delivery === current.delivery) return;
    setSavingKey(meta.key);
    setError(null);
    try {
      await savePreference({ emailType: meta.key, enabled: true, delivery });
      setRows((prev) => {
        const base = prev ?? [];
        const existing = base.find((item) => item.email_type === meta.key);
        if (existing) {
          return base.map((item) => (item.email_type === meta.key ? { ...item, delivery } : item));
        }
        return [...base, { email_type: meta.key, enabled: true, delivery }];
      });
      setSavedKey(meta.key);
      window.setTimeout(() => setSavedKey((key) => (key === meta.key ? null : key)), 2000);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save your notification settings.');
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <section className="space-y-8" aria-labelledby="notifications-heading">
      <div className="space-y-1">
        <h2 id="notifications-heading" className="text-2xl">
          Notification settings
        </h2>
        <p className="text-sm leading-relaxed text-ink-muted">
          Choose which emails Leadership Compass sends you. Changes save as soon as you toggle them.
        </p>
      </div>

      {onOpenSenderSettings && (
        <button type="button" className="btn-secondary w-fit" onClick={onOpenSenderSettings}>
          <Settings2 className="h-4 w-4" aria-hidden="true" />
          Sender settings and email templates
        </button>
      )}

      {error && <Notice>{error}</Notice>}
      {!rows && !error && <p className="text-sm text-ink-muted">Loading settings...</p>}

      {rows && (
        <div className="space-y-3">
          {LOCKED_EMAIL_TYPES.map((item) => (
            <div key={item.key} className="flex items-start justify-between gap-4 rounded-card border border-line bg-surface p-5 opacity-75">
              <div className="space-y-1">
                <p className="font-semibold">{item.title}</p>
                <p className="text-sm text-ink-muted">{item.reason}</p>
              </div>
              <span className="flex shrink-0 items-center gap-2 text-sm font-semibold text-ink-muted">
                <Bell className="h-4 w-4" aria-hidden="true" />
                Always on
              </span>
            </div>
          ))}

          {visible.map((meta) => {
            const current = prefFor(rows, meta.key) ?? { enabled: true, delivery: 'instant' as const };
            const reminderLocked = meta.key === 'reminder' && current.enabled && openSubmissions;
            return (
              <div key={meta.key} className="rounded-card border border-line bg-surface p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <p className="font-semibold">{meta.title}</p>
                    <p className="text-sm text-ink-muted">{meta.description}</p>
                    {reminderLocked && (
                      <p className="flex items-center gap-1.5 text-sm text-ink-muted">
                        <BellOff className="h-4 w-4" aria-hidden="true" />
                        On while you still have feedback to submit in an open cycle.
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={current.enabled}
                    aria-label={`${meta.title}`}
                    disabled={savingKey === meta.key}
                    onClick={() => void toggle(meta, current)}
                    className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 disabled:opacity-60 ${
                      current.enabled ? 'bg-primary' : 'bg-muted border border-line'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-surface shadow transition-transform duration-200 ${
                        current.enabled ? 'translate-x-6' : 'translate-x-1'
                      } ${current.enabled ? '' : 'bg-ink-muted'}`}
                    />
                  </button>
                </div>
                {meta.hasDelivery && current.enabled && (
                  <div role="radiogroup" aria-label={`${meta.title} delivery`} className="mt-4 flex gap-1 rounded-2xl bg-muted p-1">
                    {(
                      [
                        { value: 'instant', label: 'Each submission' },
                        { value: 'daily_digest', label: 'Daily digest' },
                        { value: 'off', label: 'Off' },
                      ] as const
                    ).map((option) => {
                      const selected =
                        option.value === 'off' ? !current.enabled : current.enabled && current.delivery === option.value;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          onClick={() => {
                            if (option.value === 'off') void toggle(meta, current);
                            else void setDelivery(meta, { ...current, enabled: true }, option.value);
                          }}
                          className={`flex-1 rounded-xl px-3 py-2 text-sm font-semibold transition-colors duration-200 ${
                            selected ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted hover:text-ink'
                          }`}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                )}
                {savedKey === meta.key && (
                  <p className="mt-3 flex items-center gap-1.5 text-sm font-semibold text-primary" role="status">
                    <Check className="h-4 w-4" aria-hidden="true" />
                    Saved
                  </p>
                )}
                {savingKey === meta.key && (
                  <Loader2 className="mt-3 h-4 w-4 animate-spin text-ink-muted" aria-hidden="true" />
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
