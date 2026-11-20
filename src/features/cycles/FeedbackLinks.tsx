import { useCallback, useState } from 'react';
import { ChevronDown, ChevronRight, Link2, Loader2 } from 'lucide-react';
import { Badge } from '@/components/Badge';
import { Notice } from '@/components/Notice';
import { revokeEvaluationLink, sendEvaluationLink } from '@/features/org/orgData';
import { formatDate } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { useAsyncData } from '@/lib/useAsyncData';

type LinkPerson = {
  id: string;
  name: string;
  email: string;
  external: boolean;
  forms: number;
  submitted: number;
  lastSent: string | null;
  lastUsed: string | null;
  revoked: boolean;
};

type AssessorRow = {
  status: string;
  assessor: { id: string; full_name: string; email: string; person_type: string; activated_at: string | null } | null;
};

async function loadLinkPeople(cycleId: string): Promise<LinkPerson[]> {
  const [assignments, links] = await Promise.all([
    supabase
      .from('assignments')
      .select('status, assessor:profiles!assessor_id(id, full_name, email, person_type, activated_at)')
      .eq('cycle_id', cycleId),
    supabase.from('evaluation_links').select('profile_id, last_sent_at, last_used_at, revoked_at').eq('cycle_id', cycleId),
  ]);
  if (assignments.error) throw assignments.error;
  const linkBy = new Map(
    ((links.data ?? []) as { profile_id: string; last_sent_at: string | null; last_used_at: string | null; revoked_at: string | null }[]).map(
      (row) => [row.profile_id, row],
    ),
  );
  const people = new Map<string, LinkPerson>();
  for (const row of (assignments.data ?? []) as unknown as AssessorRow[]) {
    const a = row.assessor;
    if (!a || (a.person_type !== 'external' && a.activated_at)) continue;
    const link = linkBy.get(a.id);
    const entry = people.get(a.id) ?? {
      id: a.id,
      name: a.full_name,
      email: a.email,
      external: a.person_type === 'external',
      forms: 0,
      submitted: 0,
      lastSent: link?.last_sent_at ?? null,
      lastUsed: link?.last_used_at ?? null,
      revoked: Boolean(link?.revoked_at),
    };
    entry.forms += 1;
    if (row.status === 'submitted') entry.submitted += 1;
    people.set(a.id, entry);
  }
  return [...people.values()].sort((x, y) => x.name.localeCompare(y.name));
}

/** People in an open cycle who answer by secure link: send a fresh link (old ones stop working) or switch it off. */
export function FeedbackLinks({ cycleId, canManage }: { cycleId: string; canManage: boolean }) {
  const load = useCallback(() => loadLinkPeople(cycleId), [cycleId]);
  const { state, reload } = useAsyncData(load);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'error' | 'info'; text: string } | null>(null);

  if (state.status !== 'ready' || state.data.length === 0) return null;

  async function act(person: LinkPerson, action: 'send' | 'revoke') {
    setBusy(person.id + action);
    setMessage(null);
    const result = action === 'send' ? await sendEvaluationLink(person.id, cycleId) : await revokeEvaluationLink(person.id, cycleId);
    setBusy(null);
    if (!result.ok) return setMessage({ tone: 'error', text: result.message });
    setMessage({
      tone: 'info',
      text: action === 'send' ? `A new link was emailed to ${person.name}. Earlier links stop working.` : `${person.name}'s link no longer works.`,
    });
    reload();
  }

  return (
    <div className="mt-5 rounded-2xl border border-line p-4 text-sm">
      <button type="button" className="flex w-full items-center gap-2 text-left font-semibold" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? <ChevronDown className="h-4 w-4" aria-hidden="true" /> : <ChevronRight className="h-4 w-4" aria-hidden="true" />}
        <Link2 className="h-4 w-4 text-primary" aria-hidden="true" />
        {state.data.length} {state.data.length === 1 ? 'person answers' : 'people answer'} by secure link
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          <p className="text-xs text-ink-muted">
            External raters and people without an active account. Their invitations and reminders carry a private link that
            works until the cycle closes.
          </p>
          <ul className="divide-y divide-line">
            {state.data.map((person) => (
              <li key={person.id} className="flex flex-wrap items-center gap-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">
                    {person.name} {person.external && <Badge tone="neutral">External</Badge>}
                  </span>
                  <span className="block truncate text-xs text-ink-muted">
                    {person.submitted}/{person.forms} submitted
                    {person.revoked
                      ? ' · link switched off'
                      : person.lastSent
                        ? ` · sent ${formatDate(person.lastSent)}`
                        : ' · not sent yet'}
                    {person.lastUsed && !person.revoked ? ` · opened ${formatDate(person.lastUsed)}` : ''}
                  </span>
                </span>
                {canManage && (
                  <span className="flex gap-2">
                    <button
                      type="button"
                      className="btn-secondary px-3 py-1.5 text-xs"
                      disabled={busy !== null}
                      onClick={() => void act(person, 'send')}
                    >
                      {busy === person.id + 'send' && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
                      {person.lastSent ? 'Resend link' : 'Send link'}
                    </button>
                    {!person.revoked && person.lastSent && (
                      <button
                        type="button"
                        className="btn-secondary px-3 py-1.5 text-xs text-danger"
                        disabled={busy !== null}
                        onClick={() => void act(person, 'revoke')}
                      >
                        Switch off
                      </button>
                    )}
                  </span>
                )}
              </li>
            ))}
          </ul>
          {message && <Notice tone={message.tone}>{message.text}</Notice>}
        </div>
      )}
    </div>
  );
}
