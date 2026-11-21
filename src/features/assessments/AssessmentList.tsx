import { useCallback } from 'react';
import { Badge } from '@/components/Badge';
import { Notice } from '@/components/Notice';
import { ASSIGNMENT_STATUS_TONES } from '@/features/assessments/assessmentModel';
import { loadMyAssessments, type AssessmentSummary } from '@/features/assessments/assessmentQueries';
import { ASSIGNMENT_STATUS_LABELS, daysLeftLabel } from '@/lib/format';
import type { AssignmentStatus } from '@/lib/records';
import { useAsyncData } from '@/lib/useAsyncData';

const ACTION_LABELS: Record<AssignmentStatus, string> = {
  not_started: 'Start feedback',
  draft: 'Continue feedback',
  submitted: 'View feedback',
};

type AssessmentListProps = {
  assessorId: string;
  onOpen: (assignmentId: string) => void;
};

export function AssessmentList({ assessorId, onOpen }: AssessmentListProps) {
  const load = useCallback(() => loadMyAssessments(assessorId), [assessorId]);
  const { state, reload } = useAsyncData(load);

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <p className="eyebrow">Review cycles</p>
        <h1 className="text-3xl sm:text-4xl">Your assessments</h1>
        <p className="max-w-2xl text-base leading-relaxed text-ink-muted">
          Talents you have been asked to give feedback on. Forms can be filled in while their review cycle is open.
        </p>
      </div>

      {state.status === 'loading' && <p className="text-sm text-ink-muted">Loading your assessments...</p>}

      {state.status === 'error' && (
        <Notice>
          We could not load your assessments.{' '}
          <button type="button" onClick={reload} className="font-semibold underline underline-offset-4">
            Try again
          </button>
        </Notice>
      )}

      {state.status === 'ready' && state.data.length === 0 && (
        <div className="rounded-card border border-dashed border-line bg-surface p-8 text-center">
          <p className="font-semibold">No assessments yet</p>
          <p className="mt-1 text-sm text-ink-muted">
            When someone asks you to give feedback during an open review, it will appear here.
          </p>
        </div>
      )}

      {state.status === 'ready' && state.data.length > 0 && (
        <ul className="space-y-4">
          {state.data.map((item) => (
            <AssessmentCard key={item.id} item={item} onOpen={onOpen} />
          ))}
        </ul>
      )}
    </div>
  );
}

function AssessmentCard({ item, onOpen }: { item: AssessmentSummary; onOpen: (assignmentId: string) => void }) {
  const details = [item.talent.department, item.talent.position].filter(Boolean).join(' · ');
  const notOpenYet = item.cycle.status === 'draft';

  return (
    <li
      data-nav-focus={item.status !== 'submitted' && item.cycle.status === 'open' ? 'pending-form' : undefined}
      className={`flex flex-col gap-5 rounded-card border border-line bg-surface p-5 transition-colors duration-200 ${notOpenYet ? 'opacity-80' : 'hover:border-primary'} sm:flex-row sm:items-center sm:justify-between sm:p-6`}>
      <div className="min-w-0 space-y-1">
        <h2 className="truncate text-lg">{item.talent.full_name}</h2>
        {details && <p className="text-sm text-ink-muted">{details}</p>}
        <p className="text-sm text-ink-muted">{item.cycle.name}</p>
      </div>
      <div className="flex flex-wrap items-center gap-3 sm:shrink-0">
        {notOpenYet ? (
          <>
            <Badge tone="neutral">Not open yet</Badge>
            <span className="text-sm text-ink-muted">The form opens when your administrator opens this cycle.</span>
          </>
        ) : (
          <>
            <Badge tone={ASSIGNMENT_STATUS_TONES[item.status]}>{ASSIGNMENT_STATUS_LABELS[item.status]}</Badge>
            <span className="text-sm font-semibold">{daysLeftLabel(item.cycle.closes_at)}</span>
            <button type="button" onClick={() => onOpen(item.id)} className="btn-primary">
              {ACTION_LABELS[item.status]}
            </button>
          </>
        )}
      </div>
    </li>
  );
}
