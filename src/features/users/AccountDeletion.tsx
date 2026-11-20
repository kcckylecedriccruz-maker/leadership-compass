import { useState } from 'react';
import { Loader2, RotateCcw, Trash2 } from 'lucide-react';
import { Badge } from '@/components/Badge';
import { Modal } from '@/components/Modal';
import { Notice } from '@/components/Notice';
import { databaseErrorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

const WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

/** "2 days 5 hours" style countdown to the permanent deletion. */
function deletionCountdown(requestedAt: string, now = Date.now()): string {
  const left = Date.parse(requestedAt) + WINDOW_MS - now;
  if (left <= 0) return 'within the hour';
  const hours = Math.ceil(left / (60 * 60 * 1000));
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  const parts = [days > 0 ? `${days} day${days === 1 ? '' : 's'}` : '', rest > 0 ? `${rest} hour${rest === 1 ? '' : 's'}` : ''];
  return `in ${parts.filter(Boolean).join(' ')}`;
}

export function DeletionBadge({ requestedAt }: { requestedAt: string }) {
  return <Badge tone="warning">Deletes {deletionCountdown(requestedAt)}</Badge>;
}

/**
 * Administrators delete a deactivated account with a 3-day recovery window. After that the name and email are
 * removed: feedback they gave stays as anonymous answers and reports about them move to "Deleted people".
 */
export function AccountDeletionButton({
  user,
  onDone,
}: {
  user: { id: string; full_name: string; deletion_requested_at: string | null };
  onDone: (message: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function recover() {
    setBusy(true);
    setError(null);
    const { error: rpcError } = await supabase.rpc('cancel_account_deletion', { p_profile: user.id });
    setBusy(false);
    if (rpcError) return setError(databaseErrorMessage(rpcError));
    onDone(`${user.full_name} was recovered. The account stays deactivated until you reactivate it.`);
  }

  async function requestDeletion() {
    setBusy(true);
    setError(null);
    const { error: rpcError } = await supabase.rpc('request_account_deletion', { p_profile: user.id });
    setBusy(false);
    if (rpcError) return setError(databaseErrorMessage(rpcError));
    setConfirming(false);
    onDone(`${user.full_name} will be deleted in 3 days. You can recover the account until then.`);
  }

  if (user.deletion_requested_at) {
    return (
      <>
        <button type="button" className="btn-secondary px-3 py-2" onClick={() => void recover()} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RotateCcw className="h-4 w-4" aria-hidden="true" />}
          Recover
        </button>
        {error && <Notice>{error}</Notice>}
      </>
    );
  }

  return (
    <>
      <button type="button" className="btn-secondary px-3 py-2 text-danger" onClick={() => setConfirming(true)}>
        <Trash2 className="h-4 w-4" aria-hidden="true" />
        Delete
      </button>
      {confirming && (
        <Modal title={`Delete ${user.full_name}?`} description="You can recover the account for 3 days." onClose={() => setConfirming(false)}>
          <div className="space-y-5">
            <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-ink-muted">
              <li>For the next 3 days the account can be recovered from this list.</li>
              <li>After 3 days the login is deleted and their name and email are removed for good.</li>
              <li>Feedback they gave stays in other people’s reports as anonymous answers.</li>
              <li>Reports about them are kept under “Deleted people” on the Dashboard.</li>
              <li>Forms they never submitted, group memberships, module access and peer links are removed.</li>
            </ul>
            {error && <Notice>{error}</Notice>}
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button type="button" className="btn-secondary" onClick={() => setConfirming(false)} disabled={busy}>
                Cancel
              </button>
              <button type="button" className="btn-primary bg-danger hover:bg-danger" onClick={() => void requestDeletion()} disabled={busy}>
                {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                Delete in 3 days
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
