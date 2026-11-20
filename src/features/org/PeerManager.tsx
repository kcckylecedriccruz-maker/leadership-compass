import { useState } from 'react';
import { Check, Loader2, Plus, X } from 'lucide-react';
import { Badge } from '@/components/Badge';
import { Notice } from '@/components/Notice';
import { assignPeer, decidePeer, removePeer, suggestPeer, type OrgData, type OrgPerson, type PeerLink } from '@/features/org/orgData';

const STATUS: Record<PeerLink['status'], { label: string; tone: 'neutral' | 'success' | 'warning' }> = {
  approved: { label: 'Approved', tone: 'success' },
  suggested: { label: 'Waiting for approval', tone: 'warning' },
  rejected: { label: 'Not approved', tone: 'neutral' },
};

/**
 * Peers who rate one employee.
 * - canManage (admin, org editor or the employee's manager): add directly, approve, reject, remove.
 * - selfMode (the employee themselves): suggest peers and withdraw pending suggestions.
 */
export function PeerManager({
  org,
  employee,
  canManage,
  selfMode = false,
  onChanged,
}: {
  org: OrgData;
  employee: OrgPerson;
  canManage: boolean;
  selfMode?: boolean;
  onChanged: () => void;
}) {
  const [choice, setChoice] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'error' | 'info'; text: string } | null>(null);

  const links = org.peers
    .filter((l) => l.employee_id === employee.id)
    .sort((a, b) => ['suggested', 'approved', 'rejected'].indexOf(a.status) - ['suggested', 'approved', 'rejected'].indexOf(b.status));
  const taken = new Set(links.filter((l) => l.status !== 'rejected').map((l) => l.peer_id));
  const options = org.people.filter((p) => p.is_active && p.id !== employee.id && !taken.has(p.id));
  const name = (id: string) => org.byId.get(id)?.full_name ?? 'Someone';

  async function run(key: string, action: () => Promise<{ ok: true } | { ok: false; message: string }>, done: string) {
    setBusy(key);
    setMessage(null);
    const result = await action();
    setBusy(null);
    if (!result.ok) {
      setMessage({ tone: 'error', text: result.message });
      return;
    }
    setMessage({ tone: 'info', text: done });
    setChoice('');
    onChanged();
  }

  const canAdd = canManage || selfMode;

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-semibold">{selfMode ? 'My peers' : 'Peers'}</p>
        <p className="text-xs text-ink-muted">
          {selfMode
            ? 'Colleagues you would like feedback from. Your immediate manager approves each suggestion.'
            : 'Colleagues who give this person Peer feedback. Approved peers are added to open cycles right away.'}
        </p>
      </div>

      {links.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line p-3 text-sm text-ink-muted">No peers yet.</p>
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line">
          {links.map((link) => {
            const status = STATUS[link.status];
            return (
              <li key={link.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className={`block truncate text-sm font-semibold ${link.status === 'rejected' ? 'text-ink-muted line-through' : ''}`}>
                    {name(link.peer_id)}
                  </span>
                  <Badge tone={status.tone}>{status.label}</Badge>
                </span>
                {canManage && link.status !== 'approved' && (
                  <button
                    type="button"
                    className="btn-secondary px-2.5 py-1.5"
                    disabled={busy !== null}
                    onClick={() => void run(link.id, () => decidePeer(link.id, true), `${name(link.peer_id)} approved.`)}
                  >
                    {busy === link.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="h-4 w-4" aria-hidden="true" />}
                    Approve
                  </button>
                )}
                {canManage && link.status === 'suggested' && (
                  <button
                    type="button"
                    className="btn-secondary px-2.5 py-1.5"
                    disabled={busy !== null}
                    onClick={() => void run(link.id, () => decidePeer(link.id, false), `${name(link.peer_id)} not approved.`)}
                  >
                    Reject
                  </button>
                )}
                {(canManage || (selfMode && link.status === 'suggested')) && (
                  <button
                    type="button"
                    className="rounded-lg p-1.5 text-ink-muted hover:bg-muted hover:text-danger"
                    aria-label={`Remove ${name(link.peer_id)}`}
                    disabled={busy !== null}
                    onClick={() => void run(link.id, () => removePeer(link.id), `${name(link.peer_id)} removed.`)}
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {canAdd && (
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!choice) return;
            void run(
              'add',
              () => (canManage ? assignPeer(employee.id, choice) : suggestPeer(choice)),
              canManage ? `${name(choice)} added as a peer.` : `${name(choice)} suggested. Your manager will review it.`,
            );
          }}
        >
          <label className="min-w-0 flex-1">
            <span className="sr-only">Choose a colleague</span>
            <select className="field-input" value={choice} onChange={(event) => setChoice(event.target.value)}>
              <option value="">Choose a colleague…</option>
              {options.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name}
                  {p.department ? ` · ${p.department}` : ''}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="btn-primary shrink-0 px-3 py-2" disabled={!choice || busy !== null}>
            {busy === 'add' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
            {canManage ? 'Add' : 'Suggest'}
          </button>
        </form>
      )}

      {message && <Notice tone={message.tone}>{message.text}</Notice>}
    </div>
  );
}
