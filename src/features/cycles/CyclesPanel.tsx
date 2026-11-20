import { useCallback, useState } from 'react';
import { AlertTriangle, CalendarDays, Loader2, Pencil, Plus, RefreshCw, Send } from 'lucide-react';
import { useAuth } from '@/auth/useAuth';
import { Badge, type BadgeTone } from '@/components/Badge';
import { Notice } from '@/components/Notice';
import { CycleDangerActions } from '@/features/cycles/CycleDangerActions';
import { CycleDialog } from '@/features/cycles/CycleDialog';
import { FeedbackLinks } from '@/features/cycles/FeedbackLinks';
import { loadCycles } from '@/features/cycles/cycleQueries';
import { CYCLE_STATUS_LABELS, formatDate, pluralise } from '@/lib/format';
import type { CycleRecord, CycleStatus } from '@/lib/records';
import { callEdgeFunction, isRecord } from '@/lib/edgeFunctions';
import { databaseErrorMessage } from '@/lib/errors';
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
  const [notice, setNotice] = useState<string | null>(null);
  const { state: auth } = useAuth();
  // Restart and Delete remove submitted feedback, so they are for administrators only.
  const isAdmin = auth.status === 'signed_in' && auth.profile.role === 'admin';

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

      {notice && <Notice tone="info">{notice}</Notice>}

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
              <CycleCard
                cycle={cycle}
                onEdit={canEdit ? () => setDialog({ mode: 'edit', cycle }) : undefined}
                onChanged={reload}
                danger={
                  isAdmin ? (
                    <CycleDangerActions
                      cycle={cycle}
                      onChanged={(message) => {
                        setNotice(message);
                        reload();
                      }}
                    />
                  ) : null
                }
              />
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

function CycleCard({
  cycle,
  onEdit,
  onChanged,
  danger,
}: {
  cycle: CycleRecord;
  onEdit?: () => void;
  onChanged: () => void;
  danger?: React.ReactNode;
}) {
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
        {(onEdit || danger) && (
          <div className="flex flex-wrap gap-2">
            {onEdit && (
              <button type="button" onClick={onEdit} className="btn-secondary">
                <Pencil className="h-4 w-4" aria-hidden="true" />
                Edit
              </button>
            )}
            {danger}
          </div>
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
      {cycle.status !== 'closed' && <EvaluationActions cycle={cycle} canEdit={Boolean(onEdit)} onChanged={onChanged} />}
      {cycle.status !== 'closed' && <CoverageWarning cycleId={cycle.id} />}
      {cycle.status === 'open' && <FeedbackLinks cycleId={cycle.id} canManage={Boolean(onEdit)} />}
    </article>
  );
}

type SoloPerson = { id: string; name: string };

/**
 * Lists employees in this cycle whose only evaluation is their own self-assessment, so their report would
 * have no one else's feedback. A warning, not a block: missing groups (no direct reports, no peers) are normal.
 */
function CoverageWarning({ cycleId }: { cycleId: string }) {
  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('assignments')
      .select('talent_id, classification, talent:talents(profile:profiles!profile_id(full_name))')
      .eq('cycle_id', cycleId);
    // People without the right to read every evaluation simply see no warning.
    if (error || !data) return [] as SoloPerson[];
    const others = new Set<string>();
    const names = new Map<string, string>();
    for (const row of data as unknown as { talent_id: string; classification: string; talent: { profile: { full_name: string } | null } | null }[]) {
      if (row.classification !== 'self') others.add(row.talent_id);
      names.set(row.talent_id, row.talent?.profile?.full_name ?? 'Unknown');
    }
    return [...names]
      .filter(([id]) => !others.has(id))
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [cycleId]);
  const { state } = useAsyncData(load);
  if (state.status !== 'ready' || state.data.length === 0) return null;

  return (
    <div className="mt-5 rounded-2xl border border-band-developing/40 bg-band-developing/10 p-4 text-sm">
      <p className="flex items-center gap-2 font-semibold text-ink">
        <AlertTriangle className="h-4 w-4 shrink-0 text-band-developing" aria-hidden="true" />
        {pluralise(state.data.length, 'employee')} with only a self-assessment
      </p>
      <p className="mt-2 text-ink-muted">{state.data.map((person) => person.name).join(', ')}</p>
      <p className="mt-2 text-xs text-ink-muted">
        No one else evaluates them in this cycle. Give them a manager or peers in Org structure and select Refresh
        evaluations, or add an evaluation under Assignments.
      </p>
    </div>
  );
}

type GenerationResult = { added: number; removed: number; total: number };

/**
 * Evaluations come from the org structure: created when the cycle opens, and again on Refresh
 * (adds what is missing, removes automatic ones that have not started). Invitations can be sent
 * straight away instead of waiting for the daily reminder run.
 */
function EvaluationActions({ cycle, canEdit, onChanged }: { cycle: CycleRecord; canEdit: boolean; onChanged: () => void }) {
  const loadCount = useCallback(async () => {
    const { count } = await supabase.from('assignments').select('id', { count: 'exact', head: true }).eq('cycle_id', cycle.id);
    return count ?? 0;
  }, [cycle.id]);
  const { state, reload } = useAsyncData(loadCount);
  const [busy, setBusy] = useState<'refresh' | 'invite' | null>(null);
  const [message, setMessage] = useState<{ tone: 'error' | 'info'; text: string } | null>(null);

  async function refresh() {
    setBusy('refresh');
    setMessage(null);
    const { data, error } = await supabase.rpc('generate_cycle_evaluations', { p_cycle_id: cycle.id });
    setBusy(null);
    if (error) {
      setMessage({ tone: 'error', text: databaseErrorMessage(error) });
      return;
    }
    const result = data as GenerationResult;
    setMessage({ tone: 'info', text: `${result.added} added, ${result.removed} removed; ${result.total} evaluations in this cycle.` });
    reload();
    onChanged();
  }

  async function sendInvites() {
    setBusy('invite');
    setMessage(null);
    let sent = 0;
    let failed = 0;
    // The server sends in batches; keep going until nothing is left.
    for (let round = 0; round < 50; round += 1) {
      const result = await callEdgeFunction('send-cycle-invites', { cycle_id: cycle.id }, isInviteResult);
      if (!result.ok) {
        setBusy(null);
        setMessage({ tone: 'error', text: result.message });
        return;
      }
      sent += result.data.sent;
      failed += result.data.failed;
      if (result.data.remaining === 0 || result.data.sent + result.data.failed === 0) break;
    }
    setBusy(null);
    setMessage({
      tone: failed > 0 ? 'error' : 'info',
      text: sent + failed === 0 ? 'Everyone has already been invited.' : `${sent} invitation${sent === 1 ? '' : 's'} sent${failed ? `, ${failed} failed` : ''}.`,
    });
  }

  return (
    <div className="mt-5 space-y-3 border-t border-line pt-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-muted">
          <span className="font-semibold text-ink">{state.status === 'ready' ? state.data : '–'} evaluations</span>
          {cycle.evaluations_generated_at
            ? ` · built from the org structure ${formatDate(cycle.evaluations_generated_at)}`
            : cycle.status === 'draft'
              ? ' · created from the org structure when the cycle opens'
              : ''}
        </p>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-secondary px-3 py-2" onClick={() => void refresh()} disabled={busy !== null}>
              {busy === 'refresh' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
              {cycle.status === 'draft' ? 'Build evaluations now' : 'Refresh evaluations'}
            </button>
            {cycle.status === 'open' && (
              <button type="button" className="btn-secondary px-3 py-2" onClick={() => void sendInvites()} disabled={busy !== null}>
                {busy === 'invite' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
                Send invitations now
              </button>
            )}
          </div>
        )}
      </div>
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
    </div>
  );
}

function isInviteResult(value: unknown): value is { sent: number; failed: number; remaining: number } {
  return isRecord(value) && typeof value.sent === 'number' && typeof value.remaining === 'number';
}
