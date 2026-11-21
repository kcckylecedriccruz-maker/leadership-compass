import { useState } from 'react';
import { Eye, EyeOff, Loader2, MessageSquare, Trash2 } from 'lucide-react';
import { Badge, type BadgeTone } from '@/components/Badge';
import { databaseErrorMessage } from '@/lib/errors';
import { formatDate } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { OVERALL, type PlanNote, type Verdict } from '@/features/ai/planNotesApi';

const VERDICTS: { id: Verdict; label: string; tone: BadgeTone }[] = [
  { id: 'agree', label: 'Agree', tone: 'success' },
  { id: 'adjust', label: 'Adjust', tone: 'warning' },
  { id: 'disagree', label: 'Disagree', tone: 'neutral' },
];

/**
 * Manager feedback on one focus area (or the whole plan): verdict + note per author. Admins and the managers the
 * report was shared with write; the immediate manager or an admin decides which notes the employee may see.
 */
export function PlanNotes({
  cycleId,
  talentId,
  scope,
  notes,
  myId,
  canWrite,
  canSetVisibility,
  latestPlanAt,
  withVerdict,
  onChanged,
}: {
  cycleId: string;
  talentId: string;
  scope: string;
  notes: PlanNote[];
  myId: string;
  canWrite: boolean;
  canSetVisibility: boolean;
  latestPlanAt: string | null;
  withVerdict: boolean;
  onChanged: () => void;
}) {
  const mine = notes.find((n) => n.author_id === myId);
  const others = notes.filter((n) => n.author_id !== myId);
  const [editing, setEditing] = useState(false);
  const [verdict, setVerdict] = useState<Verdict | null>(mine?.verdict ?? null);
  const [text, setText] = useState(mine?.note ?? '');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy('save');
    setError(null);
    const { error: rpcError } = await supabase.rpc('save_plan_note', {
      p_cycle_id: cycleId,
      p_talent_id: talentId,
      p_scope: scope,
      p_verdict: withVerdict ? verdict : null,
      p_note: text,
    });
    setBusy(null);
    if (rpcError) return setError(databaseErrorMessage(rpcError));
    setEditing(false);
    onChanged();
  }

  async function remove(note: PlanNote) {
    setBusy(note.id);
    setError(null);
    const { error: rpcError } = await supabase.rpc('delete_plan_note', { p_note_id: note.id });
    setBusy(null);
    if (rpcError) return setError(databaseErrorMessage(rpcError));
    setText('');
    setVerdict(null);
    onChanged();
  }

  async function toggleVisible(note: PlanNote) {
    setBusy(note.id);
    setError(null);
    const { error: rpcError } = await supabase.rpc('set_plan_note_visibility', { p_note_id: note.id, p_visible: !note.visible_to_employee });
    setBusy(null);
    if (rpcError) return setError(databaseErrorMessage(rpcError));
    onChanged();
  }

  const shown = canWrite ? [...(mine && !editing ? [mine] : []), ...others] : notes;
  if (!canWrite && shown.length === 0) return null;

  return (
    <div className="space-y-2 rounded-lg bg-muted/50 p-3">
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-muted">
        <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
        {scope === OVERALL ? 'Manager feedback on the whole plan' : 'Manager feedback'}
      </p>

      {shown.map((n) => {
        const earlier = latestPlanAt && n.plan_generated_at && Date.parse(n.plan_generated_at) < Date.parse(latestPlanAt);
        const v = VERDICTS.find((x) => x.id === n.verdict);
        return (
          <div key={n.id} className="space-y-1 rounded-lg bg-surface p-2 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{n.author_id === myId ? 'You' : n.author?.full_name ?? 'A manager'}</span>
              {v && <Badge tone={v.tone}>{v.label}</Badge>}
              {earlier && <span className="text-xs text-ink-muted">written on an earlier plan</span>}
              {canWrite && n.visible_to_employee && <span className="text-xs text-primary">Employee can see this</span>}
              <span className="ml-auto text-xs text-ink-muted">{formatDate(n.updated_at)}</span>
            </div>
            {n.note && <p className="whitespace-pre-wrap leading-relaxed">{n.note}</p>}
            {(canSetVisibility || n.author_id === myId) && (
              <div className="flex flex-wrap gap-3 pt-1 text-xs">
                {canSetVisibility && (
                  <button type="button" className="inline-flex items-center gap-1 font-semibold text-primary" onClick={() => void toggleVisible(n)} disabled={busy !== null}>
                    {n.visible_to_employee ? <EyeOff className="h-3.5 w-3.5" aria-hidden="true" /> : <Eye className="h-3.5 w-3.5" aria-hidden="true" />}
                    {n.visible_to_employee ? 'Hide from employee' : 'Employee can see this'}
                  </button>
                )}
                {n.author_id === myId && (
                  <>
                    <button type="button" className="font-semibold text-primary" onClick={() => setEditing(true)} disabled={busy !== null}>
                      Edit
                    </button>
                    <button type="button" className="inline-flex items-center gap-1 font-semibold text-danger" onClick={() => void remove(n)} disabled={busy !== null}>
                      {busy === n.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />}
                      Delete
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}

      {canWrite && (editing || !mine) && (
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          {withVerdict && (
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Your verdict">
              {VERDICTS.map((x) => (
                <button
                  key={x.id}
                  type="button"
                  aria-pressed={verdict === x.id}
                  onClick={() => setVerdict(verdict === x.id ? null : x.id)}
                  className={`rounded-full border px-3 py-1 text-xs font-semibold ${verdict === x.id ? 'border-primary bg-primary text-on-primary' : 'border-line bg-surface text-ink-muted hover:text-ink'}`}
                >
                  {x.label}
                </button>
              ))}
            </div>
          )}
          <textarea
            className="field-input min-h-[4rem]"
            placeholder={scope === OVERALL ? 'Your overall feedback on this plan (optional)' : 'Your feedback on this focus area (optional), e.g. what you will do to support it'}
            value={text}
            maxLength={2000}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            {mine && (
              <button type="button" className="btn-secondary px-3 py-1.5 text-xs" onClick={() => setEditing(false)} disabled={busy !== null}>
                Cancel
              </button>
            )}
            <button type="submit" className="btn-secondary px-3 py-1.5 text-xs" disabled={busy !== null || (!verdict && !text.trim())}>
              {busy === 'save' && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
              Save feedback
            </button>
          </div>
        </form>
      )}
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
