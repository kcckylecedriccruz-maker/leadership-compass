import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Loader2, Network, Search, UserRound } from 'lucide-react';
import { Badge } from '@/components/Badge';
import { Notice } from '@/components/Notice';
import { PeerManager } from '@/features/org/PeerManager';
import {
  descendantsOf,
  loadOrg,
  skipLevelOf,
  updatePerson,
  type OrgData,
  type OrgPerson,
} from '@/features/org/orgData';
import { useAsyncData } from '@/lib/useAsyncData';

export function OrgStructurePanel({ canEdit = true }: { canEdit?: boolean }) {
  const { state, reload } = useAsyncData(loadOrg);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const org = state.status === 'ready' ? state.data : null;
  const active = useMemo(() => (org ? org.people.filter((p) => p.is_active) : []), [org]);
  const roots = useMemo(
    () => active.filter((p) => !p.manager_id || !org?.byId.get(p.manager_id)?.is_active),
    [active, org],
  );
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return null;
    return active.filter((p) =>
      [p.full_name, p.email, p.department ?? '', p.position ?? ''].some((v) => v.toLowerCase().includes(needle)),
    );
  }, [active, query]);
  const selected = selectedId && org ? org.byId.get(selectedId) ?? null : null;

  const stats = {
    people: active.length,
    noManager: roots.length,
    excluded: active.filter((p) => p.exclude_rated || p.exclude_rater || p.exclude_self).length,
    pendingPeers: org?.peers.filter((l) => l.status === 'suggested').length ?? 0,
  };

  function toggle(id: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function renderNode(person: OrgPerson, depth: number): JSX.Element {
    const reports = (org?.reportsOf.get(person.id) ?? []).filter((r) => r.is_active);
    const open = !collapsed.has(person.id);
    const isSelected = person.id === selectedId;
    return (
      <li key={person.id}>
        <div
          className={`flex items-center gap-1 rounded-xl pr-2 ${isSelected ? 'bg-primary/10' : 'hover:bg-muted'}`}
          style={{ paddingLeft: `${depth * 18}px` }}
        >
          {reports.length > 0 ? (
            <button
              type="button"
              onClick={() => toggle(person.id)}
              className="rounded-lg p-1 text-ink-muted hover:text-ink"
              aria-label={open ? `Collapse ${person.full_name}` : `Expand ${person.full_name}`}
              aria-expanded={open}
            >
              {open ? <ChevronDown className="h-4 w-4" aria-hidden="true" /> : <ChevronRight className="h-4 w-4" aria-hidden="true" />}
            </button>
          ) : (
            <span className="w-6" />
          )}
          <button type="button" onClick={() => setSelectedId(person.id)} className="min-w-0 flex-1 py-1.5 text-left">
            <span className="block truncate text-sm font-semibold">{person.full_name}</span>
            <span className="block truncate text-xs text-ink-muted">
              {[person.position, person.department].filter(Boolean).join(' · ') || person.email}
              {reports.length > 0 ? ` · ${reports.length} report${reports.length === 1 ? '' : 's'}` : ''}
            </span>
          </button>
          {(person.exclude_rated || person.exclude_rater || person.exclude_self) && <Badge tone="warning">Excluded</Badge>}
        </div>
        {reports.length > 0 && open && <ul>{reports.map((r) => renderNode(r, depth + 1))}</ul>}
      </li>
    );
  }

  return (
    <section className="space-y-6" aria-labelledby="org-heading">
      <div className="space-y-1">
        <h2 id="org-heading" className="flex items-center gap-2 text-2xl">
          <Network className="h-6 w-6 text-primary" aria-hidden="true" />
          Org structure
        </h2>
        <p className="text-sm leading-relaxed text-ink-muted">
          Who reports to whom. Each cycle builds its evaluations from this when it opens: self, immediate manager, skip-level
          manager, direct reports, skip-level reports and approved peers.
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'People', value: stats.people },
          { label: 'Top of the tree', value: stats.noManager },
          { label: 'With exclusions', value: stats.excluded },
          { label: 'Peer suggestions waiting', value: stats.pendingPeers },
        ].map((item) => (
          <div key={item.label} className="rounded-card border border-line bg-surface p-4">
            <dt className="text-xs font-semibold text-ink-muted">{item.label}</dt>
            <dd className="mt-1 text-2xl font-semibold tabular-nums">{org ? item.value : '–'}</dd>
          </div>
        ))}
      </dl>

      {state.status === 'loading' && <p className="text-sm text-ink-muted">Loading the org structure...</p>}
      {state.status === 'error' && (
        <Notice>
          We could not load the org structure.{' '}
          <button type="button" onClick={reload} className="font-semibold underline underline-offset-4">
            Try again
          </button>
        </Notice>
      )}

      {org && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
          <div className="space-y-3 rounded-card border border-line bg-surface p-4">
            <label className="relative block">
              <span className="sr-only">Search people</span>
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
              <input
                className="field-input pl-10"
                placeholder="Search name, email, department or position"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            {matches ? (
              <ul className="space-y-1">
                {matches.length === 0 && <li className="px-2 py-4 text-sm text-ink-muted">No one matches.</li>}
                {matches.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(p.id)}
                      className={`w-full rounded-xl px-3 py-2 text-left ${p.id === selectedId ? 'bg-primary/10' : 'hover:bg-muted'}`}
                    >
                      <span className="block text-sm font-semibold">{p.full_name}</span>
                      <span className="block text-xs text-ink-muted">
                        Reports to {p.manager_id ? org.byId.get(p.manager_id)?.full_name ?? '—' : 'no one'}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <ul className="space-y-0.5" aria-label="Reporting tree">
                {roots.map((root) => renderNode(root, 0))}
              </ul>
            )}
          </div>

          <div className="lg:sticky lg:top-24 lg:self-start">
            {selected ? (
              <PersonEditor key={selected.id} org={org} person={selected} canEdit={canEdit} onChanged={reload} onSelect={setSelectedId} />
            ) : (
              <div className="rounded-card border border-dashed border-line bg-surface p-8 text-center text-sm text-ink-muted">
                <UserRound className="mx-auto mb-2 h-6 w-6" aria-hidden="true" />
                Select a person to see and change their reporting line, exclusions and peers.
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function PersonEditor({
  org,
  person,
  canEdit,
  onChanged,
  onSelect,
}: {
  org: OrgData;
  person: OrgPerson;
  canEdit: boolean;
  onChanged: () => void;
  onSelect: (id: string) => void;
}) {
  const [managerId, setManagerId] = useState(person.manager_id ?? '');
  const [department, setDepartment] = useState(person.department ?? '');
  const [position, setPosition] = useState(person.position ?? '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'error' | 'info'; text: string } | null>(null);

  const blocked = useMemo(() => descendantsOf(org, person.id), [org, person.id]);
  const managerOptions = org.people.filter((p) => p.is_active && p.id !== person.id && !blocked.has(p.id));
  const skip = skipLevelOf(org, person);
  const reports = (org.reportsOf.get(person.id) ?? []).filter((r) => r.is_active);
  const dirty =
    managerId !== (person.manager_id ?? '') || department !== (person.department ?? '') || position !== (person.position ?? '');

  async function save(patch: Parameters<typeof updatePerson>[1], done: string) {
    setBusy(true);
    setMessage(null);
    const result = await updatePerson(person.id, patch);
    setBusy(false);
    if (!result.ok) {
      setMessage({ tone: 'error', text: result.message });
      return;
    }
    setMessage({ tone: 'info', text: done });
    onChanged();
  }

  const exclusions: { key: 'exclude_rated' | 'exclude_rater' | 'exclude_self'; label: string; help: string }[] = [
    { key: 'exclude_rated', label: 'Not rated by others', help: 'Nobody evaluates this person.' },
    { key: 'exclude_rater', label: 'Doesn’t rate others', help: 'This person is not asked to evaluate anyone.' },
    { key: 'exclude_self', label: 'No self-assessment', help: 'This person does not assess themselves.' },
  ];

  return (
    <div className="space-y-5 rounded-card border border-line bg-surface p-5">
      <div>
        <p className="text-lg font-semibold">{person.full_name}</p>
        <p className="text-sm text-ink-muted">{person.email}</p>
      </div>

      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void save(
            { manager_id: managerId || null, department: department.trim() || null, position: position.trim() || null },
            'Saved. Open cycles keep their snapshot until you refresh them in Cycles.',
          );
        }}
      >
        <fieldset disabled={!canEdit || busy} className="space-y-4">
          <label className="block space-y-1.5">
            <span className="text-sm font-semibold">Immediate manager</span>
            <select className="field-input" value={managerId} onChange={(event) => setManagerId(event.target.value)}>
              <option value="">No manager (top of the organisation)</option>
              {managerOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name}
                  {p.position ? ` · ${p.position}` : ''}
                </option>
              ))}
            </select>
            <span className="block text-xs text-ink-muted">People who report to {person.full_name.split(' ')[0]} are not offered, to prevent loops.</span>
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1.5">
              <span className="text-sm font-semibold">Department</span>
              <input className="field-input" value={department} maxLength={100} onChange={(event) => setDepartment(event.target.value)} />
            </label>
            <label className="block space-y-1.5">
              <span className="text-sm font-semibold">Position</span>
              <input className="field-input" value={position} maxLength={100} onChange={(event) => setPosition(event.target.value)} />
            </label>
          </div>
          {canEdit && (
            <button type="submit" className="btn-primary w-full" disabled={!dirty || busy}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              Save reporting line
            </button>
          )}
        </fieldset>
      </form>

      <dl className="space-y-2 rounded-2xl bg-muted p-4 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-ink-muted">Skip-level manager</dt>
          <dd className="text-right font-semibold">
            {skip ? (
              <button type="button" className="underline-offset-4 hover:underline" onClick={() => onSelect(skip.id)}>
                {skip.full_name}
              </button>
            ) : (
              '—'
            )}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-ink-muted">Direct reports</dt>
          <dd className="text-right">
            {reports.length === 0
              ? '—'
              : reports.map((r, i) => (
                  <span key={r.id}>
                    {i > 0 && ', '}
                    <button type="button" className="font-semibold underline-offset-4 hover:underline" onClick={() => onSelect(r.id)}>
                      {r.full_name}
                    </button>
                  </span>
                ))}
          </dd>
        </div>
      </dl>

      <fieldset className="space-y-2" disabled={!canEdit || busy}>
        <legend className="mb-1 text-sm font-semibold">Exclusions</legend>
        {exclusions.map((item) => (
          <label key={item.key} className="flex items-start gap-3 rounded-xl border border-line p-3">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 accent-primary"
              checked={person[item.key]}
              onChange={(event) =>
                void save({ [item.key]: event.target.checked }, `${item.label} ${event.target.checked ? 'turned on' : 'turned off'}.`)
              }
            />
            <span>
              <span className="block text-sm font-semibold">{item.label}</span>
              <span className="block text-xs text-ink-muted">{item.help}</span>
            </span>
          </label>
        ))}
        <p className="text-xs text-ink-muted">Applies to cycles opened (or refreshed) after the change.</p>
      </fieldset>

      {message && <Notice tone={message.tone}>{message.text}</Notice>}

      <PeerManager org={org} employee={person} canManage={canEdit} onChanged={onChanged} />
    </div>
  );
}
