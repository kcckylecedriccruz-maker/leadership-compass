import { useState } from 'react';
import { Badge } from '@/components/Badge';
import { callEdgeFunction, isRecord } from '@/lib/edgeFunctions';

export function ActivationBadge({ activated }: { activated: boolean }) {
  return activated ? <Badge tone="success">Active</Badge> : <Badge tone="warning">Invited</Badge>;
}

function isResendResult(value: unknown): value is { message: string } {
  return isRecord(value) && typeof value.message === 'string';
}

export function ResendInviteButton({ profileId }: { profileId: string }) {
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleResend() {
    setSending(true);
    setMessage(null);
    const result = await callEdgeFunction('resend-invite', { profile_id: profileId }, isResendResult);
    setSending(false);
    setMessage(result.ok ? result.data.message : result.message);
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={() => void handleResend()}
        disabled={sending}
        className="btn-secondary"
      >
        {sending ? 'Sending...' : 'Resend invite'}
      </button>
      {message && (
        <p role="status" className="text-xs text-ink-muted">
          {message}
        </p>
      )}
    </div>
  );
}
