import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, ChevronRight, X } from 'lucide-react';
import {
  alertCount,
  dismissSharedReport,
  loadMyNotifications,
  navigateTo,
  onNotificationsChanged,
  type MyNotifications,
  type NavTarget,
} from '@/features/notifications/notificationsApi';
import { formatDate } from '@/lib/format';

const REFRESH_MS = 60_000;

/** Bell in the top bar: a red bubble with pending items, and a grouped list that links to where each is handled. */
export function NotificationBell({ onNavigate }: { onNavigate: () => void }) {
  const [data, setData] = useState<MyNotifications | null>(null);
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try {
      setData(await loadMyNotifications());
    } catch {
      // The bell is a convenience; if it cannot load, the rest of the app still works.
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), REFRESH_MS);
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    const stopChanged = onNotificationsChanged(onFocus);
    return () => {
      stopChanged();
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [refresh]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !panelRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  const count = data ? alertCount(data) : 0;

  function go(target: NavTarget) {
    setOpen(false);
    onNavigate();
    navigateTo(target);
  }

  async function remove(id: string) {
    await dismissSharedReport(id);
    void refresh();
  }

  const rows: { key: string; label: string; detail?: string; target: NavTarget }[] = [];
  if (data) {
    if (data.peer_suggestions > 0) {
      rows.push({
        key: 'peers',
        label: `${data.peer_suggestions} peer suggestion${data.peer_suggestions === 1 ? '' : 's'} to review`,
        detail: 'Approve or decline in My team',
        target: { view: 'My team', focus: 'peer-suggestions' },
      });
    }
    for (const f of data.forms_pending) {
      rows.push({
        key: `forms-${f.cycle}`,
        label: `${f.count} form${f.count === 1 ? '' : 's'} to complete in ${f.cycle}`,
        detail: `Closes ${formatDate(f.closes_at)}`,
        target: { view: 'My assessments', focus: 'pending-form' },
      });
    }
    if (data.new_shares > 0) {
      rows.push({
        key: 'shares',
        label: `${data.new_shares} new report${data.new_shares === 1 ? '' : 's'} shared with you`,
        detail: 'Open in My team',
        target: { view: 'My team', focus: 'shared-reports' },
      });
    }
    if (data.plans_to_release > 0) {
      rows.push({
        key: 'plans',
        label: `${data.plans_to_release} improvement plan${data.plans_to_release === 1 ? '' : 's'} not yet released`,
        detail: 'Review on the report’s How to improve tab',
        target: { view: 'Workspace', section: 'dashboard', focus: 'dashboard' },
      });
    }
  }

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={() => {
          setOpen(!open);
          if (!open) void refresh();
        }}
        className="btn-secondary relative shrink-0 px-3 py-2"
        aria-label={count > 0 ? `Notifications: ${count} pending` : 'Notifications'}
        aria-expanded={open}
      >
        <Bell className="h-4 w-4" aria-hidden="true" />
        {count > 0 && (
          <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1 text-[11px] font-bold leading-none text-on-accent">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-card border border-line bg-surface p-2 shadow-xl">
          <p className="px-2 pb-2 pt-1 text-sm font-semibold">Notifications</p>
          {rows.length === 0 && (data?.opened_shares.length ?? 0) === 0 && (
            <p className="px-2 pb-3 text-sm text-ink-muted">You’re all caught up.</p>
          )}
          <ul className="space-y-1">
            {rows.map((row) => (
              <li key={row.key}>
                <button type="button" onClick={() => go(row.target)} className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-muted">
                  <span className="h-2 w-2 shrink-0 rounded-full bg-accent" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold">{row.label}</span>
                    {row.detail && <span className="block text-xs text-ink-muted">{row.detail}</span>}
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
          {data && data.opened_shares.length > 0 && (
            <div className="mt-2 border-t border-line pt-2">
              <p className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">Shared with you</p>
              <ul className="space-y-0.5">
                {data.opened_shares.map((s) => (
                  <li key={s.id} className="flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-muted">
                    <button type="button" onClick={() => go({ view: 'My team', focus: `share-${s.id}` })} className="min-w-0 flex-1 text-left">
                      <span className="block truncate text-sm">{s.person}</span>
                      <span className="block truncate text-xs text-ink-muted">
                        {s.cycle} · {s.kind === 'individual' ? 'Individual' : 'Consolidated'}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void remove(s.id)}
                      className="rounded-lg p-1 text-ink-muted hover:bg-surface hover:text-ink"
                      aria-label={`Remove ${s.person} from notifications`}
                    >
                      <X className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
