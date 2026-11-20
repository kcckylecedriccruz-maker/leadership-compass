import { useState } from 'react';
import { Check, UserPlus, X } from 'lucide-react';
import { Badge } from '@/components/Badge';
import { Notice } from '@/components/Notice';
import { AddAssessorDialog } from '@/features/assignments/AddAssessorDialog';
import { AssignmentRow } from '@/features/assignments/AssignmentRow';
import { coverageGroups, isIncomplete } from '@/features/assignments/assignmentCoverage';
import type { AssignmentRecord, CycleRecord, ProfileRef, TalentRecord } from '@/lib/records';

type AssignmentListProps = {
  cycle: CycleRecord;
  talent: TalentRecord;
  assignments: AssignmentRecord[];
  people: ProfileRef[];
  isAdmin: boolean;
  canAdd?: boolean;
  onChanged: () => void;
};

export function AssignmentList({ cycle, talent, assignments, people, isAdmin, canAdd = true, onChanged }: AssignmentListProps) {
  const [adding, setAdding] = useState(false);
  const isClosed = cycle.status === 'closed';
  const details = [talent.position, talent.department].filter(Boolean).join(' · ');
  const groups = coverageGroups(assignments, cycle.min_group_size);
  const incomplete = isIncomplete(groups);

  return (
    <section className="space-y-5 rounded-card border border-line bg-canvas p-5 sm:p-6" aria-label={`Assessors for ${talent.profile.full_name}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg">{talent.profile.full_name}</h3>
            <Badge tone={incomplete ? 'warning' : 'success'}>{incomplete ? 'Incomplete' : 'Complete'}</Badge>
          </div>
          {details && <p className="text-sm text-ink-muted">{details}</p>}
          <p className="text-sm text-ink-muted">
            {cycle.name} · {summaryText(assignments)}
          </p>
        </div>
{canAdd && (
                  <button
          type="button"
          onClick={() => setAdding(true)}
          disabled={isClosed}
          className="btn-primary shrink-0"
        >
          <UserPlus className="h-4 w-4" aria-hidden="true" />
          Add assessor
        </button>
        )}
      </div>

      <ul className="grid gap-3 sm:grid-cols-3" aria-label="Required feedback groups">
        {groups.map((group) => (
          <li key={group.classification} className="rounded-2xl border border-line bg-surface p-4">
            <p className="flex items-center gap-2 text-sm font-semibold">
              {group.present ? (
                <Check className="h-4 w-4 text-band-strength" aria-hidden="true" />
              ) : (
                <X className="h-4 w-4 text-danger" aria-hidden="true" />
              )}
              {group.label}
              <span className="sr-only">{group.present ? ' included' : ' missing'}</span>
            </p>
            <p className="mt-1 text-sm text-ink-muted">
              {group.count} {group.count === 1 ? 'person' : 'people'}
            </p>
            {group.hidden && (
              <p className="mt-2 text-xs leading-relaxed text-ink-muted">
                Results for this group will be hidden for anonymity.
              </p>
            )}
          </li>
        ))}
      </ul>

      {isClosed && <Notice tone="info">This cycle has closed, so new assessors cannot be added.</Notice>}

      {assignments.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line bg-surface p-6 text-center">
          <p className="font-semibold">No assessors yet</p>
          <p className="mt-1 text-sm text-ink-muted">Add the people who will give feedback on this talent.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {assignments.map((assignment) => (
            <AssignmentRow key={assignment.id} assignment={assignment} isAdmin={isAdmin} onChanged={onChanged} />
          ))}
        </ul>
      )}

      {adding && (
        <AddAssessorDialog
          cycle={cycle}
          talent={talent}
          people={people}
          assignedIds={new Set(assignments.map((a) => a.assessor?.id).filter((id): id is string => Boolean(id)))}
          assignedKinds={new Map(assignments.filter((a) => a.assessor).map((a) => [a.assessor!.id, a.classification]))}
          onAdded={onChanged}
          onClose={() => setAdding(false)}
        />
      )}
    </section>
  );
}

function summaryText(assignments: AssignmentRecord[]): string {
  const submitted = assignments.filter((item) => item.status === 'submitted').length;
  const count = assignments.length;
  const assessors = `${count} ${count === 1 ? 'assessor' : 'assessors'}`;
  return `${assessors}, ${submitted} submitted`;
}
