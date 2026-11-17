import { useEffect, useState } from 'react';
import { Badge, type BadgeTone } from '@/components/Badge';
import { ActivationBadge, ResendInviteButton } from '@/features/people/ActivationStatus';
import { CLASSIFICATION_LABELS, ASSIGNMENT_STATUS_LABELS } from '@/lib/format';
import { databaseErrorMessage } from '@/lib/errors';
import { CLASSIFICATIONS, type AssignmentRecord, type AssignmentStatus, type Classification } from '@/lib/records';
import { supabase } from '@/lib/supabase';

type AssignmentRowProps = {
  assignment: AssignmentRecord;
  isAdmin: boolean;
  onChanged: () => void;
};

const STATUS_TONES: Record<AssignmentStatus, BadgeTone> = {
  not_started: 'neutral',
  draft: 'warning',
  submitted: 'success',
};

export function AssignmentRow({ assignment, isAdmin, onChanged }: AssignmentRowProps) {
  const [pending, setPending] = useState<'classification' | 'remove' | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!confirmingRemove) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setConfirmingRemove(false);
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [confirmingRemove]);

  async function changeClassification(value: Classification) {
    if (value === assignment.classification) return;
    setPending('classification');
    setError(null);
    const { error: rpcError } = await supabase.rpc('set_assignment_classification', {
      p_assignment_id: assignment.id,
      p_classification: value,
    });
    setPending(null);
    if (rpcError) {
      setError(databaseErrorMessage(rpcError));
      return;
    }
    onChanged();
  }

  async function removeAssignment() {
    setPending('remove');
    setError(null);
    const { error: rpcError } = await supabase.rpc('remove_assignment', { p_assignment_id: assignment.id });
    setPending(null);
    if (rpcError) {
      setError(databaseErrorMessage(rpcError));
      setConfirmingRemove(false);
      return;
    }
    onChanged();
  }

  const assessorName = assignment.assessor?.full_name ?? 'Unknown person';
  const busy = pending !== null;

  return (
    <li className="rounded-card border border-line bg-surface p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0 space-y-1">
          <p className="truncate font-semibold">{assessorName}</p>
          {assignment.assessor && <p className="truncate text-sm text-ink-muted">{assignment.assessor.email}</p>}
          {assignment.assessor && (
            <div className="pt-1">
              <ActivationBadge activated={assignment.assessor.activated_at !== null} />
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {isAdmin ? (
            <label className="flex items-center gap-2 text-sm text-ink-muted">
              <span className="sr-only">Assessor type for {assessorName}</span>
              <select
                className="rounded-xl border border-line bg-surface px-3 py-2 text-sm font-semibold text-ink transition-colors duration-200 focus:border-primary disabled:opacity-60"
                value={assignment.classification}
                disabled={busy}
                onChange={(event) => void changeClassification(event.target.value as Classification)}
              >
                {CLASSIFICATIONS.map((option) => (
                  <option key={option} value={option}>
                    {CLASSIFICATION_LABELS[option]}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <Badge tone="neutral">{CLASSIFICATION_LABELS[assignment.classification]}</Badge>
          )}

          {assignment.assessor && assignment.assessor.activated_at === null && (
            <ResendInviteButton profileId={assignment.assessor.id} />
          )}

          <Badge tone={STATUS_TONES[assignment.status]}>{ASSIGNMENT_STATUS_LABELS[assignment.status]}</Badge>

          {isAdmin && !confirmingRemove && (
            <button
              type="button"
              onClick={() => setConfirmingRemove(true)}
              disabled={busy}
              className="rounded-xl px-3 py-2 text-sm font-semibold text-danger transition-colors duration-200 hover:bg-danger-soft disabled:opacity-60"
            >
              Remove
            </button>
          )}

          {isAdmin && confirmingRemove && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setConfirmingRemove(false)}
                disabled={busy}
                autoFocus
                className="btn-secondary px-3 py-2"
              >
                Keep
              </button>
              <button
                type="button"
                onClick={() => void removeAssignment()}
                disabled={busy}
                className="inline-flex items-center justify-center rounded-xl bg-danger px-3 py-2 text-sm font-semibold text-surface transition-opacity duration-200 hover:opacity-90 disabled:opacity-60"
              >
                {pending === 'remove' ? 'Removing...' : 'Yes, remove'}
              </button>
            </div>
          )}
        </div>
      </div>

      {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
    </li>
  );
}
