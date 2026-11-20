import { useCallback, useMemo, useState } from 'react';
import { Check, Search, UserPlus, X } from 'lucide-react';
import type { Classification } from '@/lib/records';
import { supabase } from '@/lib/supabase';
import { useAsyncData } from '@/lib/useAsyncData';

export type Employee = {
  id: string;
  full_name: string;
  email: string;
  position: string | null;
  department: string | null;
  manager_id: string | null;
};

/** Active employees (not outside people, not deleted). */
async function loadEmployees(): Promise<Employee[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, email, position, department, manager_id')
    .eq('person_type', 'employee')
    .eq('is_active', true)
    .is('deleted_at', null)
    .order('full_name');
  if (error) throw error;
  return (data ?? []) as Employee[];
}

/** The people the org chart says fit this relationship to the person being evaluated. */
function orgSuggestions(employees: Employee[], subjectProfileId: string, kind: Classification): Set<string> {
  const byId = new Map(employees.map((e) => [e.id, e]));
  const subject = byId.get(subjectProfileId);
  const reportsOf = (id: string) => employees.filter((e) => e.manager_id === id).map((e) => e.id);
  if (kind === 'skip_level_manager') {
    const manager = subject?.manager_id ? byId.get(subject.manager_id) : undefined;
    return new Set(manager?.manager_id ? [manager.manager_id] : []);
  }
  if (kind === 'direct_report') return new Set(reportsOf(subjectProfileId));
  if (kind === 'skip_level_report') return new Set(reportsOf(subjectProfileId).flatMap((id) => reportsOf(id)));
  if (kind === 'peer' && subject?.manager_id) {
    // Colleagues with the same manager are the usual peers.
    return new Set(reportsOf(subject.manager_id).filter((id) => id !== subjectProfileId));
  }
  return new Set();
}

export type PickerValue = { kind: 'existing'; employee: Employee } | { kind: 'new' } | null;

/**
 * Searchable list of active employees. Hides the person being evaluated and anyone already evaluating them in this
 * cycle, puts the org chart's matches for the chosen type on top, and ends with "Someone new".
 */
export function EmployeePicker({
  subjectProfileId,
  excludeIds,
  kind,
  value,
  onChange,
}: {
  subjectProfileId: string;
  excludeIds: Set<string>;
  kind: Classification;
  value: PickerValue;
  onChange: (value: PickerValue) => void;
}) {
  const load = useCallback(() => loadEmployees(), []);
  const { state } = useAsyncData(load);
  const [query, setQuery] = useState('');

  const employees = useMemo(() => (state.status === 'ready' ? state.data : []), [state]);
  const suggested = useMemo(() => orgSuggestions(employees, subjectProfileId, kind), [employees, subjectProfileId, kind]);
  const needle = query.trim().toLowerCase();
  const available = employees.filter(
    (e) =>
      e.id !== subjectProfileId &&
      !excludeIds.has(e.id) &&
      (!needle || [e.full_name, e.email, e.position ?? '', e.department ?? ''].some((v) => v.toLowerCase().includes(needle))),
  );
  const top = available.filter((e) => suggested.has(e.id));
  const rest = available.filter((e) => !suggested.has(e.id));

  if (value?.kind === 'existing') {
    const e = value.employee;
    return (
      <div className="flex items-center gap-3 rounded-xl border border-primary bg-muted px-3 py-2">
        <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{e.full_name}</span>
          <span className="block truncate text-xs text-ink-muted">{[e.position, e.department, e.email].filter(Boolean).join(' · ')}</span>
        </span>
        <button type="button" className="rounded-lg p-1.5 text-ink-muted hover:bg-surface hover:text-ink" onClick={() => onChange(null)} aria-label="Choose someone else">
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    );
  }

  const row = (e: Employee, hint?: string) => (
    <li key={e.id}>
      <button
        type="button"
        onClick={() => onChange({ kind: 'existing', employee: e })}
        className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{e.full_name}</span>
          <span className="block truncate text-xs text-ink-muted">{[e.position, e.department, e.email].filter(Boolean).join(' · ')}</span>
        </span>
        {hint && <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">{hint}</span>}
      </button>
    </li>
  );

  return (
    <div className="space-y-2">
      <label className="relative block">
        <span className="sr-only">Search employees</span>
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
        <input
          className="field-input pl-9"
          placeholder="Search name, email, department or position"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          autoComplete="off"
        />
      </label>
      <div className="max-h-64 overflow-y-auto rounded-xl border border-line">
        {state.status === 'loading' && <p className="px-3 py-3 text-sm text-ink-muted">Loading employees...</p>}
        {state.status === 'error' && <p className="px-3 py-3 text-sm text-ink-muted">Could not load employees. Use Someone new.</p>}
        {state.status === 'ready' && (
          <ul className="divide-y divide-line">
            {top.map((e) => row(e, 'From org chart'))}
            {rest.map((e) => row(e))}
            {top.length + rest.length === 0 && (
              <li className="px-3 py-3 text-sm text-ink-muted">{needle ? 'No employee matches.' : 'Everyone available is already assigned.'}</li>
            )}
            <li>
              <button
                type="button"
                onClick={() => onChange({ kind: 'new' })}
                className={`flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-semibold ${value?.kind === 'new' ? 'bg-muted text-primary' : 'text-primary hover:bg-muted'}`}
              >
                <UserPlus className="h-4 w-4" aria-hidden="true" />
                Someone new (not in the list)
              </button>
            </li>
          </ul>
        )}
      </div>
    </div>
  );
}
