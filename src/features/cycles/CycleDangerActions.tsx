import { useState } from 'react';
import { Loader2, RotateCcw, Trash2 } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { Notice } from '@/components/Notice';
import { databaseErrorMessage } from '@/lib/errors';
import type { CycleRecord } from '@/lib/records';
import { supabase } from '@/lib/supabase';

type Action = 'restart' | 'delete';

const COPY: Record<Action, { title: string; button: string; points: string[] }> = {
  restart: {
    title: 'Restart this cycle',
    button: 'Restart cycle',
    points: [
      'Every answer in this cycle is permanently removed, including submitted feedback.',
      'Every evaluation goes back to "Not started" and reminders start over.',
      'Reports shared with managers for this cycle are unshared.',
      'The cycle returns to Draft. Check the dates, then open it again; evaluations are rebuilt from the org structure and new invitations go out.',
    ],
  },
  delete: {
    title: 'Delete this cycle',
    button: 'Delete cycle',
    points: [
      'The cycle, all of its evaluations and every answer are permanently removed.',
      'Reports for this cycle disappear for everyone, including shared reports.',
      'The audit trail keeps a record that the cycle was deleted, with counts only.',
    ],
  },
};

/** Administrator-only Restart and Delete for a cycle, each confirmed by typing the cycle's name. */
export function CycleDangerActions({ cycle, onChanged }: { cycle: CycleRecord; onChanged: (message: string) => void }) {
  const [action, setAction] = useState<Action | null>(null);

  return (
    <>
      {cycle.status !== 'draft' && (
        <button type="button" className="btn-secondary" onClick={() => setAction('restart')}>
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          Restart
        </button>
      )}
      <button type="button" className="btn-secondary text-danger" onClick={() => setAction('delete')}>
        <Trash2 className="h-4 w-4" aria-hidden="true" />
        Delete
      </button>
      {action && (
        <ConfirmDialog
          cycle={cycle}
          action={action}
          onClose={() => setAction(null)}
          onDone={(message) => {
            setAction(null);
            onChanged(message);
          }}
        />
      )}
    </>
  );
}

function ConfirmDialog({
  cycle,
  action,
  onClose,
  onDone,
}: {
  cycle: CycleRecord;
  action: Action;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const copy = COPY[action];
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const matches = typed.trim().toLowerCase() === cycle.name.trim().toLowerCase();

  async function confirm() {
    if (!matches) return;
    setBusy(true);
    setError(null);
    const fn = action === 'restart' ? 'restart_cycle' : 'delete_cycle';
    const { data, error: rpcError } = await supabase.rpc(fn, { p_cycle: cycle.id, p_confirm_name: typed });
    setBusy(false);
    if (rpcError) {
      setError(databaseErrorMessage(rpcError));
      return;
    }
    const result = (data ?? {}) as Record<string, number>;
    onDone(
      action === 'restart'
        ? `${cycle.name} was restarted: ${result.answers_removed ?? 0} answers removed, ${result.evaluations_reset ?? 0} evaluations reset. It is now a draft.`
        : `${cycle.name} was deleted with ${result.evaluations_removed ?? 0} evaluations.`,
    );
  }

  return (
    <Modal title={copy.title} description="This cannot be undone." onClose={onClose}>
      <form
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          void confirm();
        }}
      >
        <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-ink-muted">
          {copy.points.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
        <label className="block space-y-2">
          <span className="text-sm font-semibold">
            Type <span className="rounded bg-muted px-1.5 py-0.5 font-mono">{cycle.name}</span> to confirm
          </span>
          <input className="field-input" value={typed} onChange={(event) => setTyped(event.target.value)} autoComplete="off" autoFocus />
        </label>
        {error && <Notice>{error}</Notice>}
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn-primary bg-danger hover:bg-danger" disabled={!matches || busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {copy.button}
          </button>
        </div>
      </form>
    </Modal>
  );
}
