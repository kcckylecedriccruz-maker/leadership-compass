import { useCallback, useState } from 'react';
import { AlertTriangle, CalendarDays, Pencil, Plus } from 'lucide-react';
import { Badge, type BadgeTone } from '@/components/Badge';
import { Notice } from '@/components/Notice';
import { CycleDialog } from '@/features/cycles/CycleDialog';
import { loadCycles } from '@/features/cycles/cycleQueries';
import { CYCLE_STATUS_LABELS, formatDate, pluralise } from '@/lib/format';
import type { CycleRecord, CycleStatus } from '@/lib/records';
import { supabase } from '@/lib/supabase';
import { useAsyncData } from '@/lib/useAsyncData';

const STATUS_TONES: Record<CycleStatus, BadgeTone> = {
  draft: 'neutral',
  open: 'success',
  closed: 'warning',
};

type DialogState = { mode: 'create' } | { mode: 'edit'; cycle: CycleRecord } | null;

export function CyclesPanel({ canEdit = true }: { canEdit?: boolean }) {
  const { state, reload } = useAsyncData(loadCycles);
  const [dialog, setDialog] = useState<DialogState>(null);

  return (
    <section className="space-y-6" aria-labelledby="cycles-heading">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h2 id="cycles-heading" className="text-2xl">
            Cycles
          </h2>
          <p className="text-sm leading-relaxed text-ink-muted">
            Each cycle is one round of assessments, with its own dates and reminders.
          </p>
        </div>
{canEdit && (
                  <button type="button" onClick={() => setDialog({ mode: 'create' })} className="btn-primary">
          <Plus className="h-4 w-4" aria-hidden="true" />
          New cycle
        </button>
        )}
      </div>

      {state.status === 'loading' && <p className="text-sm text-ink-muted">Loading cycles...</p>}

      {state.status === 'error' && (
        <Notice>
          We could not load cycles.{' '}
          <button type="button" onClick={reload} className="font-semibold underline underline-offset-4">
            Try again
          </button>
        </Notice>
      )}

      {state.status === 'ready' && state.data.length === 0 && (
        <div className="rounded-card border border-dashed border-line bg-surface p-8 text-center">
          <p className="font-semibold">No cycles yet</p>
          <p className="mt-1 text-sm text-ink-muted">Create your first cycle to start setting up assessments.</p>
        </div>
      )}

      {state.status === 'ready' && state.data.length > 0 && (
        <ul className="space-y-4">
          {state.data.map((cycle) => (
            <li key={cycle.id}>
              <CycleCard cycle={cycle} onEdit={canEdit ? () => setDialog({ mode: 'edit', cycle }) : undefined} />
            </li>
          ))}
        </ul>
      )}

      {dialog && (
        <CycleDialog
          cycle={dialog.mode === 'edit' ? dialog.cycle : null}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            reload();
          }}
        />
      )}
    </section>
  );
}

function CycleCard({ cycle, onEdit }: { cycle: CycleRecord; onEdit?: () => void }) {
  return (
    <article className="rounded-card border border-line bg-surface p-6 transition-shadow duration-200 hover:shadow-md">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="min-w-0 break-words text-lg">{cycle.name}</h3>
            <Badge tone={STATUS_TONES[cycle.status]}>{CYCLE_STATUS_LABELS[cycle.status]}</Badge>
          </div>
          <p className="flex items-center gap-2 text-sm text-ink-muted">
            <CalendarDays className="h-4 w-4 shrink-0" aria-hidden="true" />
            {formatDate(cycle.opens_at)} to {formatDate(cycle.closes_at)}
          </p>
        </div>
{onEdit && (
                  <button type="button" onClick={onEdit} className="btn-secondary">
          <Pencil className="h-4 w-4" aria-hidden="true" />
          Edit
        </button>
        )}
      </div>
      <dl className="mt-5 grid grid-cols-1 gap-4 border-t border-line pt-5 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-ink-muted">Reminders</dt>
          <dd className="font-semibold">Every {pluralise(cycle.reminder_every_days, 'day')}</dd>
        </div>
        <div>
          <dt className="text-ink-muted">Alert on submit</dt>
          <dd className="font-semibold">{cycle.alert_on_submit ? 'On' : 'Off'}</dd>
        </div>
        <div>
          <dt className="text-ink-muted">Minimum group size</dt>
          <dd className="font-semibold">{cycle.min_group_size}</dd>
        </div>
      </dl>
      {cycle.status !== 'closed' && <CoverageWarning cycleId={cycle.id} />}
    </article>
  );
}

type CoverageGap = { gap_talent_id: string; gap_talent_name: string; gap_missing: string[] };

/**
 * Lists talents who are missing an assessor type in this cycle. A warning, not a
 * block: the cycle can still open, and reports hide groups too small to stay anonymous.
 */
function CoverageWarning({ cycleId }: { cycleId: string }) {
  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('cycle_coverage_gaps', { p_cycle_id: cycleId });
    // People without the right to check coverage simply see no warning.
    if (error) return [] as CoverageGap[];
    return (data ?? []) as CoverageGap[];
  }, [cycleId]);
  const { state } = useAsyncData(load);
  if (state.status !== 'ready' || state.data.length === 0) return null;

  return (
    <div className="mt-5 rounded-2xl border border-band-developing/40 bg-band-developing/10 p-4 text-sm">
      <p className="flex items-center gap-2 font-semibold text-ink">
        <AlertTriangle className="h-4 w-4 shrink-0 text-band-developing" aria-hidden="true" />
        {pluralise(state.data.length, 'talent')} still missing assessors
      </p>
      <ul className="mt-2 space-y-1 text-ink-muted">
        {state.data.map((gap) => (
          <li key={gap.gap_talent_id}>
            <span className="font-semibold text-ink">{gap.gap_talent_name}</span>: no {gap.gap_missing.join(', ').toLowerCase()}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-ink-muted">
        You can still open the cycle. Add assessors under Assignments for a fuller 360; groups with fewer responses
        than the minimum group size are hidden in reports to keep feedback anonymous.
      </p>
    </div>
  );
}
