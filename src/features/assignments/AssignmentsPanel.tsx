import { useCallback, useState } from 'react';
import { FormField } from '@/components/FormField';
import { Notice } from '@/components/Notice';
import { AssignmentList } from '@/features/assignments/AssignmentList';
import { isIncomplete, coverageGroups } from '@/features/assignments/assignmentCoverage';
import { loadCycleAssignments, loadKnownPeople } from '@/features/assignments/assignmentQueries';
import { loadCycles } from '@/features/cycles/cycleQueries';
import { loadTalents } from '@/features/talents/talentQueries';
import type { CycleRecord, ProfileRef, TalentRecord } from '@/lib/records';
import { supabase } from '@/lib/supabase';
import { useAsyncData } from '@/lib/useAsyncData';

type Group = { id: string; name: string };

type SetupData = {
  cycles: CycleRecord[];
  talents: TalentRecord[];
  people: ProfileRef[];
  groups: Group[];
  /** profile id -> group ids */
  membership: Map<string, string[]>;
  /** profile ids of outside people (person_type external) */
  outside: Set<string>;
};

async function loadSetupData(): Promise<SetupData> {
  const [cycles, talents, people, groups, members, outside] = await Promise.all([
    loadCycles(),
    loadTalents(),
    loadKnownPeople(),
    supabase.from('user_groups').select('id, name').order('name'),
    supabase.from('user_group_members').select('group_id, profile_id'),
    supabase.from('profiles').select('id').eq('person_type', 'external'),
  ]);
  // Groups are a navigation aid: if they cannot be read, the page still works with All.
  const membership = new Map<string, string[]>();
  for (const row of (members.data ?? []) as { group_id: string; profile_id: string }[]) {
    membership.set(row.profile_id, [...(membership.get(row.profile_id) ?? []), row.group_id]);
  }
  return {
    cycles,
    talents,
    people,
    groups: (groups.data ?? []) as Group[],
    membership,
    outside: new Set(((outside.data ?? []) as { id: string }[]).map((row) => row.id)),
  };
}

const ALL = 'all';
const NO_GROUP = 'none';
const OUTSIDE = 'outside';

function defaultCycle(cycles: CycleRecord[]): CycleRecord | null {
  return cycles.find((item) => item.status === 'open') ?? cycles[0] ?? null;
}

export function AssignmentsPanel({
  isAdmin,
  managerId,
  canAdd = true,
}: {
  isAdmin: boolean;
  managerId?: string;
  canAdd?: boolean;
}) {
  const { state, reload } = useAsyncData(loadSetupData);
  const [selectedCycleId, setSelectedCycleId] = useState('');
  const [tab, setTab] = useState(ALL);
  const [query, setQuery] = useState('');

  if (state.status === 'loading') return <p className="text-sm text-ink-muted">Loading assignments...</p>;

  if (state.status === 'error') {
    return (
      <Notice>
        We could not load assignments.{' '}
        <button type="button" onClick={reload} className="font-semibold underline underline-offset-4">
          Try again
        </button>
      </Notice>
    );
  }

  const { cycles, people, groups, membership, outside } = state.data;
  const scoped = managerId
    ? state.data.talents.filter((talent) => talent.managers.some((item) => item.manager_profile_id === managerId))
    : state.data.talents;
  const inTab = (talent: TalentRecord, id: string) => {
    if (id === ALL) return true;
    if (id === OUTSIDE) return outside.has(talent.profile_id);
    const ids = membership.get(talent.profile_id) ?? [];
    if (id === NO_GROUP) return ids.length === 0 && !outside.has(talent.profile_id);
    return ids.includes(id);
  };
  const tabs = [
    { id: ALL, label: 'All' },
    ...groups.map((group) => ({ id: group.id, label: group.name })),
    { id: NO_GROUP, label: 'No group' },
    { id: OUTSIDE, label: 'Outside people' },
  ]
    .map((item) => ({ ...item, count: scoped.filter((talent) => inTab(talent, item.id)).length }))
    .filter((item) => item.id === ALL || item.count > 0);
  const activeTab = tabs.some((item) => item.id === tab) ? tab : ALL;
  const needle = query.trim().toLowerCase();
  const talents = scoped.filter(
    (talent) =>
      inTab(talent, activeTab) &&
      (!needle ||
        [talent.profile.full_name, talent.profile.email, talent.department ?? '', talent.position ?? ''].some((value) =>
          value.toLowerCase().includes(needle),
        )),
  );
  const cycle = cycles.find((item) => item.id === selectedCycleId) ?? defaultCycle(cycles);

  return (
    <section className="space-y-6" aria-labelledby="assignments-heading">
      <div className="space-y-1">
        <h2 id="assignments-heading" className="text-2xl">
          Assignments
        </h2>
        <p className="text-sm leading-relaxed text-ink-muted">
          {!managerId
            ? 'Every talent and the assessors giving feedback on them.'
            : 'Every talent you manage and the assessors giving feedback on them.'}
        </p>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <FormField id="assignment-search" label="Find a person">
          <input
            id="assignment-search"
            className="field-input"
            placeholder="Name, email, department or position"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </FormField>
        <FormField id="assignment-cycle" label="Cycle">
          <select
            id="assignment-cycle"
            className="field-input"
            value={cycle?.id ?? ''}
            onChange={(event) => setSelectedCycleId(event.target.value)}
          >
            {cycles.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </FormField>
      </div>

      {tabs.length > 1 && (
        <div role="tablist" aria-label="Groups" className="flex gap-1 overflow-x-auto rounded-2xl bg-muted p-1">
          {tabs.map((item) => {
            const selected = item.id === activeTab;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setTab(item.id)}
                className={`shrink-0 whitespace-nowrap rounded-xl px-3 py-2 text-sm font-semibold transition-colors ${
                  selected ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted hover:text-ink'
                }`}
              >
                {item.label}
                <span className="ml-1.5 text-xs font-normal text-ink-muted">{item.count}</span>
              </button>
            );
          })}
        </div>
      )}

      {cycles.length === 0 && <Notice tone="info">No cycles have been created yet.</Notice>}
      {scoped.length === 0 && (
        <Notice tone="info">
          {!managerId ? 'No talents have been added yet.' : 'You do not manage any talents yet.'}
        </Notice>
      )}
      {scoped.length > 0 && talents.length === 0 && <p className="text-sm text-ink-muted">No one matches in this tab.</p>}

      {cycle && talents.length > 0 && (
        <CycleAssignments key={cycle.id} cycle={cycle} talents={talents} people={people} isAdmin={isAdmin} canAdd={canAdd} managerView={Boolean(managerId)} />
      )}
    </section>
  );
}

type CycleAssignmentsProps = {
  cycle: CycleRecord;
  talents: TalentRecord[];
  people: ProfileRef[];
  isAdmin: boolean;
  canAdd: boolean;
  managerView: boolean;
};

function CycleAssignments({ cycle, talents, people, isAdmin, canAdd, managerView }: CycleAssignmentsProps) {
  const load = useCallback(() => loadCycleAssignments(cycle.id), [cycle.id]);
  const { state, reload } = useAsyncData(load);

  if (state.status === 'loading') return <p className="text-sm text-ink-muted">Loading assessors...</p>;

  if (state.status === 'error') {
    return (
      <Notice>
        We could not load the assessors.{' '}
        <button type="button" onClick={reload} className="font-semibold underline underline-offset-4">
          Try again
        </button>
      </Notice>
    );
  }

  const assignments = state.data;
  // Tiles follow the tab: only evaluations of the people shown.
  const shownIds = new Set(talents.map((talent) => talent.id));
  const shown = assignments.filter((item) => shownIds.has(item.talent_id));
  const submitted = shown.filter((item) => item.status === 'submitted').length;
  const incompleteCount = talents.filter((talent) =>
    isIncomplete(coverageGroups(assignments.filter((item) => item.talent_id === talent.id), cycle.min_group_size)),
  ).length;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryTile label={managerView ? 'People you manage' : 'People shown'} value={talents.length} />
        <SummaryTile label="Assessors assigned" value={shown.length} />
        <SummaryTile label="Submitted" value={submitted} />
        <SummaryTile label="Incomplete" value={incompleteCount} tone={incompleteCount > 0 ? 'warning' : 'neutral'} />
      </div>

      <ul className="space-y-5">
        {talents.map((talent) => (
          <li key={talent.id}>
            <AssignmentList
              canAdd={canAdd}
              cycle={cycle}
              talent={talent}
              assignments={assignments.filter((item) => item.talent_id === talent.id)}
              people={people}
              isAdmin={isAdmin}
              onChanged={reload}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function SummaryTile({ label, value, tone = 'neutral' }: { label: string; value: number; tone?: 'neutral' | 'warning' }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <p className="text-sm text-ink-muted">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${tone === 'warning' ? 'text-band-developing' : ''}`}>{value}</p>
    </div>
  );
}
