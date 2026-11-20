import { useCallback, useState } from 'react';
import { Loader2, Share2, X } from 'lucide-react';
import { Notice } from '@/components/Notice';
import { loadShareTargets, loadSharesFor, shareReport, unshareReport, type ShareKind } from '@/features/reports/reportSharing';
import { useAsyncData } from '@/lib/useAsyncData';

/** Admin only: share this person's report with their immediate or skip-level manager. */
export function SharePanel({ cycleId, talentId }: { cycleId: string; talentId: string }) {
  const load = useCallback(async () => {
    const [targets, shares] = await Promise.all([loadShareTargets(talentId), loadSharesFor(cycleId, talentId)]);
    return { targets, shares };
  }, [cycleId, talentId]);
  const { state, reload } = useAsyncData(load);
  const [recipient, setRecipient] = useState('');
  const [kind, setKind] = useState<ShareKind>('consolidated');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'error' | 'info'; text: string } | null>(null);

  async function run(action: () => Promise<{ ok: true } | { ok: false; message: string }>, done: string) {
    setBusy(true);
    setMessage(null);
    const result = await action();
    setBusy(false);
    setMessage(result.ok ? { tone: 'info', text: done } : { tone: 'error', text: result.message });
    if (result.ok) reload();
  }

  if (state.status === 'loading') return <p className="text-sm text-ink-muted">Loading sharing...</p>;
  if (state.status === 'error') return <Notice>We could not load sharing for this report.</Notice>;
  const { targets, shares } = state.data;

  return (
    <section className="space-y-4 rounded-card border border-line bg-surface p-5" aria-labelledby="share-heading">
      <div className="space-y-1">
        <h2 id="share-heading" className="flex items-center gap-2 text-lg">
          <Share2 className="h-5 w-5 text-primary" aria-hidden="true" />
          Share with managers
        </h2>
        <p className="text-sm text-ink-muted">
          Reports are private to administrators and to the person themselves after the cycle closes. Share a consolidated or
          individual report with their immediate or skip-level manager. In individual reports, only the managers’ feedback
          carries names; peer and direct-report feedback stays anonymous.
        </p>
      </div>

      {shares.length > 0 && (
        <ul className="divide-y divide-line rounded-xl border border-line">
          {shares.map((share) => (
            <li key={share.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1">
                <span className="font-semibold">{share.shared_with_name}</span>
                <span className="text-ink-muted"> · {share.kind === 'individual' ? 'Individual report' : 'Consolidated report'}</span>
              </span>
              <button
                type="button"
                className="rounded-lg p-1.5 text-ink-muted hover:bg-muted hover:text-danger"
                aria-label={`Stop sharing with ${share.shared_with_name}`}
                disabled={busy}
                onClick={() => void run(() => unshareReport(share.id), `Stopped sharing with ${share.shared_with_name}.`)}
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {targets.length === 0 ? (
        <Notice tone="info">This person has no immediate manager in the org structure, so there is no one to share with.</Notice>
      ) : (
        <form
          className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]"
          onSubmit={(event) => {
            event.preventDefault();
            const target = targets.find((t) => t.id === recipient);
            if (!target) return;
            void run(() => shareReport(cycleId, talentId, target.id, kind), `Shared with ${target.name}.`);
          }}
        >
          <label>
            <span className="sr-only">Share with</span>
            <select className="field-input" value={recipient} onChange={(event) => setRecipient(event.target.value)}>
              <option value="">Share with…</option>
              {targets.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.relation})
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="sr-only">Report type</span>
            <select className="field-input" value={kind} onChange={(event) => setKind(event.target.value as ShareKind)}>
              <option value="consolidated">Consolidated report</option>
              <option value="individual">Individual report</option>
            </select>
          </label>
          <button type="submit" className="btn-primary" disabled={!recipient || busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            Share
          </button>
        </form>
      )}

      {message && <Notice tone={message.tone}>{message.text}</Notice>}
    </section>
  );
}
