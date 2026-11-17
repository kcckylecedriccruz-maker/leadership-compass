import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, Download, Loader2, RefreshCw, Search } from 'lucide-react';
import { Notice } from '@/components/Notice';
import {
  EMPTY_FILTERS,
  PAGE_SIZE,
  exportAuditCsv,
  loadAuditPage,
  loadPeopleNames,
  type AuditEntry,
  type AuditFilters,
  type AuditSource,
} from '@/features/audit/auditQueries';

const SOURCE_LABELS: Record<AuditSource, string> = {
  app: 'App action',
  data_change: 'Data change',
  auth: 'Sign-in / out',
};

const SOURCE_STYLES: Record<AuditSource, string> = {
  app: 'bg-primary/10 text-primary',
  data_change: 'bg-muted text-ink-muted',
  auth: 'bg-band-developing/15 text-ink',
};

const ENTITIES = ['profiles', 'talents', 'talent_managers', 'cycles', 'assignments', 'app_settings', 'notifications', 'audit_log'];

const DATE_TIME = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'medium' });

function humanise(action: string): string {
  return action.replace(/[._]/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

type LoadState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; entries: AuditEntry[]; total: number };

export function AuditTrailPanel() {
  const [draft, setDraft] = useState<AuditFilters>(EMPTY_FILTERS);
  const [filters, setFilters] = useState<AuditFilters>(EMPTY_FILTERS);
  const [page, setPage] = useState(0);
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportNote, setExportNote] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    void loadPeopleNames().then(setNames);
  }, []);

  useEffect(() => {
    let active = true;
    setState({ status: 'loading' });
    loadAuditPage(filters, page).then(
      (result) => active && setState({ status: 'ready', ...result }),
      (cause: unknown) => {
        console.error('Could not load the audit trail', cause);
        if (active) setState({ status: 'error' });
      },
    );
    return () => {
      active = false;
    };
  }, [filters, page, version]);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  function apply(next: AuditFilters) {
    setFilters(next);
    setPage(0);
    setExpanded(null);
  }

  async function handleExport() {
    setExporting(true);
    setExportNote(null);
    try {
      const { count } = await exportAuditCsv(filters);
      setExportNote(`Exported ${count} entr${count === 1 ? 'y' : 'ies'}${count >= 10000 ? ' (limit reached; narrow the filters for the rest)' : ''}.`);
    } catch (cause) {
      console.error('Export failed', cause);
      setExportNote('The export failed. Please try again.');
    } finally {
      setExporting(false);
    }
  }

  const totalPages = state.status === 'ready' ? Math.max(1, Math.ceil(state.total / PAGE_SIZE)) : 1;

  function actorLabel(entry: AuditEntry): string {
    if (!entry.actor_id) return 'System';
    return names.get(entry.actor_id) || entry.actor_email || entry.actor_id;
  }

  function subjectLabel(entry: AuditEntry): string | null {
    if (!entry.entity_id) return null;
    if (entry.entity === 'profiles') return names.get(entry.entity_id) ?? entry.entity_id;
    return entry.entity_id;
  }

  return (
    <section className="space-y-6" aria-labelledby="audit-heading">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <h2 id="audit-heading" className="text-2xl">
            Audit trail
          </h2>
          <p className="text-sm leading-relaxed text-ink-muted">
            Who did what, and when. Entries are append-only and cannot be edited or deleted. Feedback ratings and notes are
            never copied here.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button type="button" className="btn-secondary px-3 py-2" onClick={refresh} aria-label="Refresh">
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
          </button>
          <button type="button" className="btn-secondary px-3 py-2" onClick={() => void handleExport()} disabled={exporting}>
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Download className="h-4 w-4" aria-hidden="true" />}
            Export CSV
          </button>
        </div>
      </div>

      <form
        className="grid gap-3 rounded-card border border-line bg-surface p-4 sm:grid-cols-2 lg:grid-cols-6"
        onSubmit={(event) => {
          event.preventDefault();
          apply(draft);
        }}
      >
        <label className="relative sm:col-span-2">
          <span className="sr-only">Search</span>
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
          <input
            className="field-input pl-10"
            placeholder="Action, email or record id"
            value={draft.search}
            onChange={(event) => setDraft({ ...draft, search: event.target.value })}
          />
        </label>
        <label>
          <span className="sr-only">Source</span>
          <select
            className="field-input"
            value={draft.source}
            onChange={(event) => setDraft({ ...draft, source: event.target.value as AuditFilters['source'] })}
          >
            <option value="all">All sources</option>
            {(Object.keys(SOURCE_LABELS) as AuditSource[]).map((source) => (
              <option key={source} value={source}>
                {SOURCE_LABELS[source]}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">Record type</span>
          <select className="field-input" value={draft.entity} onChange={(event) => setDraft({ ...draft, entity: event.target.value })}>
            <option value="all">All records</option>
            {ENTITIES.map((entity) => (
              <option key={entity} value={entity}>
                {humanise(entity)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">From date</span>
          <input type="date" className="field-input" value={draft.from} onChange={(event) => setDraft({ ...draft, from: event.target.value })} />
        </label>
        <label>
          <span className="sr-only">To date</span>
          <input type="date" className="field-input" value={draft.to} onChange={(event) => setDraft({ ...draft, to: event.target.value })} />
        </label>
        <div className="flex gap-2 sm:col-span-2 lg:col-span-6 lg:justify-end">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setDraft(EMPTY_FILTERS);
              apply(EMPTY_FILTERS);
            }}
          >
            Clear
          </button>
          <button type="submit" className="btn-primary py-2.5">
            Apply filters
          </button>
        </div>
      </form>

      {exportNote && <Notice tone="info">{exportNote}</Notice>}

      {state.status === 'loading' && <p className="text-sm text-ink-muted">Loading the audit trail...</p>}
      {state.status === 'error' && (
        <Notice>
          We could not load the audit trail.{' '}
          <button type="button" onClick={refresh} className="font-semibold underline underline-offset-4">
            Try again
          </button>
        </Notice>
      )}

      {state.status === 'ready' && state.entries.length === 0 && (
        <div className="rounded-card border border-dashed border-line bg-surface p-8 text-center">
          <p className="font-semibold">No entries</p>
          <p className="mt-1 text-sm text-ink-muted">Nothing matches these filters.</p>
        </div>
      )}

      {state.status === 'ready' && state.entries.length > 0 && (
        <>
          <p className="text-xs text-ink-muted">
            {state.total.toLocaleString()} entr{state.total === 1 ? 'y' : 'ies'} · page {page + 1} of {totalPages}
          </p>
          <ol className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
            {state.entries.map((entry) => {
              const open = expanded === entry.id;
              const subject = subjectLabel(entry);
              return (
                <li key={entry.id}>
                  <button
                    type="button"
                    className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted sm:items-center"
                    aria-expanded={open}
                    onClick={() => setExpanded(open ? null : entry.id)}
                  >
                    <span className="min-w-0 flex-1 space-y-1 sm:flex sm:items-center sm:gap-4 sm:space-y-0">
                      <span className="block shrink-0 text-xs tabular-nums text-ink-muted sm:w-44">
                        {DATE_TIME.format(new Date(entry.created_at))}
                      </span>
                      <span className="block min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">{humanise(entry.action)}</span>
                        <span className="block truncate text-xs text-ink-muted">
                          by {actorLabel(entry)}
                          {subject ? ` · ${humanise(entry.entity)}: ${subject}` : ''}
                        </span>
                      </span>
                      <span className={`inline-flex shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${SOURCE_STYLES[entry.source]}`}>
                        {SOURCE_LABELS[entry.source]}
                      </span>
                    </span>
                    <ChevronDown
                      className={`mt-1 h-4 w-4 shrink-0 text-ink-muted transition-transform sm:mt-0 ${open ? 'rotate-180' : ''}`}
                      aria-hidden="true"
                    />
                  </button>
                  {open && <AuditDetails entry={entry} />}
                </li>
              );
            })}
          </ol>
          <div className="flex items-center justify-between">
            <button type="button" className="btn-secondary px-3 py-2" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              Newer
            </button>
            <button
              type="button"
              className="btn-secondary px-3 py-2"
              disabled={page + 1 >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Older
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

function AuditDetails({ entry }: { entry: AuditEntry }) {
  const before = (entry.details.before ?? null) as Record<string, unknown> | null;
  const after = (entry.details.after ?? null) as Record<string, unknown> | null;
  const isDiff = before !== null && after !== null && typeof before === 'object' && typeof after === 'object';
  const keys = isDiff ? Array.from(new Set([...Object.keys(before), ...Object.keys(after)])) : [];
  const other = Object.fromEntries(Object.entries(entry.details).filter(([key]) => !isDiff || (key !== 'before' && key !== 'after')));

  return (
    <div className="space-y-3 bg-muted/60 px-4 py-4 text-sm">
      <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[8rem_1fr]">
        <dt className="text-ink-muted">Entry id</dt>
        <dd className="break-all font-mono">{entry.id}</dd>
        <dt className="text-ink-muted">Actor</dt>
        <dd className="break-all">{entry.actor_email ?? entry.actor_id ?? 'System (scheduler or server)'}</dd>
        <dt className="text-ink-muted">Record</dt>
        <dd className="break-all">
          {entry.entity}
          {entry.entity_id ? ` / ${entry.entity_id}` : ''}
        </dd>
      </dl>
      {keys.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[28rem] text-left text-xs">
            <thead>
              <tr className="text-ink-muted">
                <th className="py-1 pr-3 font-semibold">Field</th>
                <th className="py-1 pr-3 font-semibold">Before</th>
                <th className="py-1 font-semibold">After</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((key) => (
                <tr key={key} className="border-t border-line align-top">
                  <td className="py-1.5 pr-3 font-semibold">{key}</td>
                  <td className="break-all py-1.5 pr-3 text-danger">{formatValue(before?.[key])}</td>
                  <td className="break-all py-1.5 text-primary">{formatValue(after?.[key])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {Object.keys(other).length > 0 && (
        <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-xl bg-surface p-3 text-xs">{JSON.stringify(other, null, 2)}</pre>
      )}
    </div>
  );
}
