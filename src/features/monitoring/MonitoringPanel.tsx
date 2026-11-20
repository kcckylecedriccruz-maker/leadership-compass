import { useCallback, useState } from 'react';
import { Activity } from 'lucide-react';
import { Notice } from '@/components/Notice';
import { supabase } from '@/lib/supabase';
import { useAsyncData } from '@/lib/useAsyncData';

type Monitoring = {
  daily: { day: string; page_views: number; errors: number }[];
  top_pages: { path: string; views: number }[];
  recent_errors: { created_at: string; path: string; detail: string | null }[];
  ai_use: { action: string; uses: number }[];
  sign_ins: number;
  active_people: number;
};

const AI_LABELS: Record<string, string> = {
  'ai.person_summary': 'Feedback summaries',
  'ai.cycle_insights': 'Cycle insights',
  'ai.explanations_drafted': 'Form help drafted',
  'ai.ask': 'Questions asked',
  'ai.compare_cycles': 'Cycle comparisons',
  'ai.person_trend': 'Person trends',
  'ai.team_insights': 'Team insights',
};

/** Administrators: usage and health of the app (anonymous page views, browser errors, AI use, sign-ins). */
export function MonitoringPanel() {
  const [days, setDays] = useState(14);
  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('app_monitoring', { p_days: days });
    if (error) throw error;
    return data as Monitoring;
  }, [days]);
  const { state, reload } = useAsyncData(load);
  const data = state.status === 'ready' ? state.data : null;
  const views = data?.daily.reduce((sum, d) => sum + d.page_views, 0) ?? 0;
  const errors = data?.daily.reduce((sum, d) => sum + d.errors, 0) ?? 0;
  const peak = Math.max(1, ...(data?.daily.map((d) => d.page_views) ?? [1]));

  return (
    <section className="space-y-6" aria-labelledby="monitoring-heading">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h2 id="monitoring-heading" className="flex items-center gap-2 text-2xl">
            <Activity className="h-6 w-6 text-primary" aria-hidden="true" />
            Monitoring
          </h2>
          <p className="text-sm text-ink-muted">
            Anonymous page views and browser errors (no names or user ids are stored), AI use and sign-ins. An uptime check on
            GitHub also tests the live site every 6 hours.
          </p>
        </div>
        <label className="block space-y-1">
          <span className="text-sm font-semibold">Period</span>
          <select className="field-input" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={7}>Last 7 days</option>
            <option value={14}>Last 14 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
        </label>
      </div>

      {state.status === 'loading' && <p className="text-sm text-ink-muted">Loading...</p>}
      {state.status === 'error' && (
        <Notice>
          We could not load monitoring.{' '}
          <button type="button" onClick={reload} className="font-semibold underline underline-offset-4">
            Try again
          </button>
        </Notice>
      )}

      {data && (
        <>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ['Page views', views],
              ['Browser errors', errors],
              ['Sign-ins', data.sign_ins],
              ['People signed in', data.active_people],
            ].map(([label, value]) => (
              <div key={label as string} className="rounded-card border border-line bg-surface p-4">
                <dt className="text-xs font-semibold text-ink-muted">{label}</dt>
                <dd className={`mt-1 text-2xl font-semibold tabular-nums ${label === 'Browser errors' && Number(value) > 0 ? 'text-danger' : ''}`}>{value}</dd>
              </div>
            ))}
          </dl>

          <div className="rounded-card border border-line bg-surface p-5">
            <h3 className="mb-3 font-semibold">Page views per day</h3>
            {data.daily.length === 0 ? (
              <p className="text-sm text-ink-muted">No visits recorded yet.</p>
            ) : (
              <ul className="space-y-1.5">
                {data.daily.map((d) => (
                  <li key={d.day} className="flex items-center gap-3 text-xs">
                    <span className="w-20 shrink-0 tabular-nums text-ink-muted">{d.day}</span>
                    <span className="h-3 rounded bg-primary" style={{ width: `${(d.page_views / peak) * 70}%`, minWidth: d.page_views > 0 ? '4px' : 0 }} />
                    <span className="tabular-nums">{d.page_views}</span>
                    {d.errors > 0 && <span className="text-danger">{d.errors} error{d.errors === 1 ? '' : 's'}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <div className="rounded-card border border-line bg-surface p-5">
              <h3 className="mb-3 font-semibold">Most used screens</h3>
              <ul className="space-y-1 text-sm">
                {data.top_pages.map((p) => (
                  <li key={p.path} className="flex justify-between gap-3">
                    <span className="truncate text-ink-muted">{p.path.replace(/^\/#?/, '').replace('#', ' · ') || 'Home'}</span>
                    <span className="tabular-nums">{p.views}</span>
                  </li>
                ))}
                {data.top_pages.length === 0 && <li className="text-ink-muted">Nothing yet.</li>}
              </ul>
            </div>
            <div className="rounded-card border border-line bg-surface p-5">
              <h3 className="mb-3 font-semibold">AI features used</h3>
              <ul className="space-y-1 text-sm">
                {data.ai_use.map((a) => (
                  <li key={a.action} className="flex justify-between gap-3">
                    <span className="text-ink-muted">{AI_LABELS[a.action] ?? a.action}</span>
                    <span className="tabular-nums">{a.uses}</span>
                  </li>
                ))}
                {data.ai_use.length === 0 && <li className="text-ink-muted">Not used yet. (Note coach and form help are not counted.)</li>}
              </ul>
            </div>
          </div>

          <div className="rounded-card border border-line bg-surface p-5">
            <h3 className="mb-3 font-semibold">Recent browser errors</h3>
            {data.recent_errors.length === 0 ? (
              <p className="text-sm text-ink-muted">No errors recorded.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {data.recent_errors.map((e, i) => (
                  <li key={i} className="rounded-lg bg-muted p-2">
                    <p className="text-xs text-ink-muted">
                      {new Date(e.created_at).toLocaleString()} · {e.path}
                    </p>
                    <p className="font-mono text-xs">{e.detail}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </section>
  );
}
