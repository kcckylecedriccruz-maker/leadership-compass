import { useCallback, useState } from 'react';
import { FormField } from '@/components/FormField';
import { Notice } from '@/components/Notice';
import { AssignmentList } from '@/features/assignments/AssignmentList';
import { isIncomplete, coverageGroups } from '@/features/assignments/assignmentCoverage';
import { loadCycleAssignments, loadKnownPeople } from '@/features/assignments/assignmentQueries';
import { loadCycles } from '@/features/cycles/cycleQueries';
import { loadTalents } from '@/features/talents/talentQueries';
import type { CycleRecord, ProfileRef, TalentRecord } from '@/lib/records';
import { useAsyncData } from '@/lib/useAsyncData';

type SetupData = {
  cycles: CycleRecord[];
  talents: TalentRecord[];
  people: ProfileRef[];
};

async function loadSetupData(): Promise<SetupData> {
  const [cycles, talents, people] = await Promise.all([loadCycles(), loadTalents(), loadKnownPeople()]);
  return { cycles, talents, people };
}

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

  const { cycles, people } = state.data;
  const talents = managerId
    ? state.data.talents.filter((talent) => talent.managers.some((item) => item.manager_profile_id === managerId))
    : state.data.talents;
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

      {cycles.length === 0 && <Notice tone="info">No cycles have been created yet.</Notice>}
      {talents.length === 0 && (
        <Notice tone="info">
          {!managerId ? 'No talents have been added yet.' : 'You do not manage any talents yet.'}
        </Notice>
      )}

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
  const submitted = assignments.filter((item) => item.status === 'submitted').length;
  const incompleteCount = talents.filter((talent) =>
    isIncomplete(coverageGroups(assignments.filter((item) => item.talent_id === talent.id), cycle.min_group_size)),
  ).length;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryTile label={managerView ? 'Talents you manage' : 'Talents'} value={talents.length} />
        <SummaryTile label="Assessors assigned" value={assignments.length} />
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
