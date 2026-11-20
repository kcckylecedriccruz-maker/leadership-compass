import { useCallback, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Badge, type BadgeTone } from '@/components/Badge';
import { Modal } from '@/components/Modal';
import { Notice } from '@/components/Notice';
import { CLASSIFICATION_LABELS, formatDate } from '@/lib/format';
import type { Classification, CycleRecord } from '@/lib/records';
import { supabase } from '@/lib/supabase';
import { useAsyncData } from '@/lib/useAsyncData';

type Status = 'submitted' | 'draft' | 'not_started';

type Form = {
  id: string;
  status: Status;
  classification: Classification;
  submittedAt: string | null;
  assessor: { id: string; name: string; email: string; outside: boolean };
  subject: { id: string; name: string; outside: boolean };
};

type FormRow = {
  id: string;
  status: Status;
  classification: Classification;
  submitted_at: string | null;
  assessor: { id: string; full_name: string; email: string; person_type: string } | null;
  talent: { id: string; profile: { full_name: string; person_type: string } | null } | null;
};

const STATUS_LABEL: Record<Status, string> = { submitted: 'Submitted', draft: 'In progress', not_started: 'Not started' };
const STATUS_TONE: Record<Status, BadgeTone> = { submitted: 'success', draft: 'warning', not_started: 'neutral' };

async function loadForms(cycleId: string): Promise<Form[]> {
  const { data, error } = await supabase
    .from('assignments')
    .select(
      'id, status, classification, submitted_at, assessor:profiles!assessor_id(id, full_name, email, person_type), talent:talents!talent_id(id, profile:profiles!profile_id(full_name, person_type))',
    )
    .eq('cycle_id', cycleId);
  if (error) throw error;
  return ((data ?? []) as unknown as FormRow[]).map((row) => ({
    id: row.id,
    status: row.status,
    classification: row.classification,
    submittedAt: row.submitted_at,
    assessor: {
      id: row.assessor?.id ?? '',
      name: row.assessor?.full_name ?? 'Unknown',
      email: row.assessor?.email ?? '',
      outside: row.assessor?.person_type === 'external',
    },
    subject: {
      id: row.talent?.id ?? '',
      name: row.talent?.profile?.full_name ?? 'Unknown',
      outside: row.talent?.profile?.person_type === 'external',
    },
  }));
}

type View = 'assessor' | 'subject';
type Filter = 'all' | 'pending' | 'complete';

type Line = { key: string; name: string; detail: string; outside: boolean; forms: Form[]; counts: Record<Status, number> };

function countStatuses(forms: Form[]): Record<Status, number> {
  return {
    submitted: forms.filter((f) => f.status === 'submitted').length,
    draft: forms.filter((f) => f.status === 'draft').length,
    not_started: forms.filter((f) => f.status === 'not_started').length,
  };
}

function buildLines(forms: Form[], view: View): Line[] {
  const map = new Map<string, Line>();
  for (const form of forms) {
    const person = view === 'assessor' ? form.assessor : form.subject;
    const line = map.get(person.id) ?? {
      key: person.id,
      name: person.name,
      detail: view === 'assessor' ? form.assessor.email : '',
      outside: person.outside,
      forms: [],
      counts: { submitted: 0, draft: 0, not_started: 0 },
    };
    line.forms.push(form);
    map.set(person.id, line);
  }
  return [...map.values()]
    .map((line) => ({ ...line, counts: countStatuses(line.forms) }))
    // People with the most still to do first, then by name.
    .sort((a, b) => b.forms.length - b.counts.submitted - (a.forms.length - a.counts.submitted) || a.name.localeCompare(b.name));
}

/** Admin view of who has submitted, who is in progress and who has not started, for one cycle. */
export function ReviewStatusDialog({ cycle, onClose }: { cycle: CycleRecord; onClose: () => void }) {
  const load = useCallback(() => loadForms(cycle.id), [cycle.id]);
  const { state, reload } = useAsyncData(load);
  const [view, setView] = useState<View>('assessor');
  const [filter, setFilter] = useState<Filter>('pending');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  const forms = useMemo(() => (state.status === 'ready' ? state.data : []), [state]);
  const totals = countStatuses(forms);
  const percent = forms.length === 0 ? 0 : Math.round((totals.submitted / forms.length) * 100);
  const needle = query.trim().toLowerCase();
  const lines = buildLines(forms, view).filter((line) => {
    const done = line.counts.submitted === line.forms.length;
    if (filter === 'pending' && done) return false;
    if (filter === 'complete' && !done) return false;
    return !needle || line.name.toLowerCase().includes(needle) || line.detail.toLowerCase().includes(needle);
  });

  return (
    <Modal title={`Review status: ${cycle.name}`} description={`${formatDate(cycle.opens_at)} to ${formatDate(cycle.closes_at)}`} onClose={onClose} size="wide">
      {state.status === 'loading' && <p className="text-sm text-ink-muted">Loading status...</p>}
      {state.status === 'error' && (
        <Notice>
          We could not load the status.{' '}
          <button type="button" onClick={reload} className="font-semibold underline underline-offset-4">
            Try again
          </button>
        </Notice>
      )}
      {state.status === 'ready' && (
        <div className="space-y-5">
          <div>
            <div className="mb-2 flex items-baseline justify-between text-sm">
              <span className="font-semibold">{percent}% submitted</span>
              <span className="text-ink-muted">{forms.length} evaluations</span>
            </div>
            <div className="flex h-2.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
              <div className="bg-band-strength" style={{ width: `${(totals.submitted / Math.max(forms.length, 1)) * 100}%` }} />
              <div className="bg-band-developing" style={{ width: `${(totals.draft / Math.max(forms.length, 1)) * 100}%` }} />
            </div>
            <dl className="mt-3 grid grid-cols-3 gap-3">
              {(['submitted', 'draft', 'not_started'] as const).map((status) => (
                <div key={status} className="rounded-xl border border-line p-3">
                  <dt className="text-xs text-ink-muted">{STATUS_LABEL[status]}</dt>
                  <dd className="text-xl font-semibold tabular-nums">{totals[status]}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div role="tablist" aria-label="View" className="flex gap-1 rounded-xl bg-muted p-1">
              {(
                [
                  ['assessor', 'By assessor'],
                  ['subject', 'By person evaluated'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={view === id}
                  onClick={() => {
                    setView(id);
                    setOpen(null);
                  }}
                  className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${view === id ? 'bg-surface shadow-sm' : 'text-ink-muted hover:text-ink'}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <select className="field-input w-auto" value={filter} onChange={(e) => setFilter(e.target.value as Filter)} aria-label="Show">
              <option value="pending">Still pending</option>
              <option value="complete">All submitted</option>
              <option value="all">Everyone</option>
            </select>
            <input
              className="field-input min-w-0 flex-1"
              placeholder="Search name or email"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search"
            />
          </div>

          <p className="text-xs text-ink-muted">
            {view === 'assessor'
              ? 'Each person giving feedback and how many of their forms are done.'
              : 'Each person being evaluated and how much of their feedback is in.'}{' '}
            Select a row to see each form.
          </p>

          {lines.length === 0 ? (
            <p className="text-sm text-ink-muted">{filter === 'pending' ? 'Nothing pending. Everyone has submitted.' : 'No one matches.'}</p>
          ) : (
            <ul className="divide-y divide-line rounded-xl border border-line">
              {lines.map((line) => {
                const expanded = open === line.key;
                const done = line.counts.submitted;
                return (
                  <li key={line.key}>
                    <button
                      type="button"
                      className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-muted"
                      aria-expanded={expanded}
                      onClick={() => setOpen(expanded ? null : line.key)}
                    >
                      {expanded ? <ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" /> : <ChevronRight className="h-4 w-4 shrink-0" aria-hidden="true" />}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">
                          {line.name} {line.outside && <Badge tone="neutral">Outside</Badge>}
                        </span>
                        {line.detail && <span className="block truncate text-xs text-ink-muted">{line.detail}</span>}
                      </span>
                      <span className="shrink-0 text-right text-xs text-ink-muted">
                        <span className="block text-sm font-semibold text-ink tabular-nums">
                          {done}/{line.forms.length} submitted
                        </span>
                        {line.counts.draft > 0 && `${line.counts.draft} in progress`}
                        {line.counts.draft > 0 && line.counts.not_started > 0 && ' · '}
                        {line.counts.not_started > 0 && `${line.counts.not_started} not started`}
                      </span>
                    </button>
                    {expanded && (
                      <ul className="space-y-1 bg-muted/40 px-10 py-2">
                        {line.forms
                          .slice()
                          .sort((a, b) => a.status.localeCompare(b.status))
                          .map((form) => (
                            <li key={form.id} className="flex flex-wrap items-center gap-2 text-sm">
                              <span className="min-w-0 flex-1 truncate">
                                {view === 'assessor'
                                  ? form.classification === 'self'
                                    ? 'Self-assessment'
                                    : `${form.subject.name}`
                                  : form.classification === 'self'
                                    ? 'Self-assessment'
                                    : form.assessor.name}
                                <span className="text-ink-muted"> · {CLASSIFICATION_LABELS[form.classification] ?? form.classification}</span>
                              </span>
                              <Badge tone={STATUS_TONE[form.status]}>{STATUS_LABEL[form.status]}</Badge>
                              {form.submittedAt && <span className="text-xs text-ink-muted">{formatDate(form.submittedAt)}</span>}
                            </li>
                          ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </Modal>
  );
}
