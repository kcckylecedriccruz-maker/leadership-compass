import { useState } from 'react';
import { KeyRound, Pencil, Plus, UserRound } from 'lucide-react';
import { Badge } from '@/components/Badge';
import { Notice } from '@/components/Notice';
import { CreateTalentDialog } from '@/features/talents/CreateTalentDialog';
import { EditTalentDialog } from '@/features/talents/EditTalentDialog';
import { requestTemporaryPassword } from '@/features/auth/temporaryPassword';
import { ActivationBadge, ResendInviteButton } from '@/features/people/ActivationStatus';
import { loadKnownPeople } from '@/features/assignments/assignmentQueries';
import { loadTalents } from '@/features/talents/talentQueries';
import type { ProfileRef, TalentRecord } from '@/lib/records';
import { supabase } from '@/lib/supabase';
import { useAsyncData } from '@/lib/useAsyncData';

type TalentData = { talents: TalentRecord[]; people: ProfileRef[] };

type DialogState = { mode: 'create' } | { mode: 'edit'; talent: TalentRecord } | null;

async function loadTalentData(): Promise<TalentData> {
  const [talents, people] = await Promise.all([loadTalents(), loadKnownPeople()]);
  return { talents, people };
}

export function TalentsPanel({ canEdit = true }: { canEdit?: boolean }) {
  const { state, reload } = useAsyncData(loadTalentData);
  const [dialog, setDialog] = useState<DialogState>(null);

  return (
    <section className="space-y-6" aria-labelledby="talents-heading">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h2 id="talents-heading" className="text-2xl">
            Talents
          </h2>
          <p className="text-sm leading-relaxed text-ink-muted">
            The people being assessed, and the immediate manager each one reports to.
          </p>
        </div>
{canEdit && (
                  <button type="button" onClick={() => setDialog({ mode: 'create' })} className="btn-primary">
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add talent
        </button>
        )}
      </div>

      {state.status === 'loading' && <p className="text-sm text-ink-muted">Loading talents...</p>}

      {state.status === 'error' && (
        <Notice>
          We could not load talents.{' '}
          <button type="button" onClick={reload} className="font-semibold underline underline-offset-4">
            Try again
          </button>
        </Notice>
      )}

      {state.status === 'ready' && state.data.talents.length === 0 && (
        <div className="rounded-card border border-dashed border-line bg-surface p-8 text-center">
          <p className="font-semibold">No talents yet</p>
          <p className="mt-1 text-sm text-ink-muted">Add the first talent to start assigning assessors.</p>
        </div>
      )}

      {state.status === 'ready' && state.data.talents.length > 0 && (
        <ul className="space-y-3">
          {state.data.talents.map((talent) => (
            <li key={talent.id}>
              <TalentRow talent={talent} onEdit={canEdit ? () => setDialog({ mode: 'edit', talent }) : undefined} />
            </li>
          ))}
        </ul>
      )}

      {dialog?.mode === 'create' && state.status === 'ready' && (
        <CreateTalentDialog
          people={state.data.people}
          talents={state.data.talents}
          onClose={() => setDialog(null)}
          onCreated={reload}
          onShowTalent={(talent) => setDialog({ mode: 'edit', talent })}
        />
      )}

      {dialog?.mode === 'edit' && state.status === 'ready' && (
        <EditTalentDialog
          talent={dialog.talent}
          people={state.data.people}
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

function TalentRow({ talent, onEdit }: { talent: TalentRecord; onEdit?: () => void }) {
  const details = [talent.position, talent.department].filter(Boolean).join(' · ');
  const [sending, setSending] = useState(false);
  const [sendMessage, setSendMessage] = useState<string | null>(null);

  async function handleSendTemporaryPassword() {
    setSending(true);
    setSendMessage(null);
    const { data } = await supabase.auth.getSession();
    setSendMessage(await requestTemporaryPassword(talent.profile.email, data.session?.access_token));
    setSending(false);
  }

  return (
    <article className="flex flex-col gap-4 rounded-card border border-line bg-surface p-5 transition-shadow duration-200 hover:shadow-md sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-4">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-muted text-primary">
          <UserRound className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 space-y-1">
          <p className="truncate font-semibold">{talent.profile.full_name}</p>
          <p className="truncate text-sm text-ink-muted">{talent.profile.email}</p>
          {details && <p className="truncate text-sm text-ink-muted">{details}</p>}
          <div className="pt-1">
            <ActivationBadge activated={talent.profile.activated_at !== null} />
          </div>
          <p className="pt-1 text-sm">
            {talent.managers.length > 0 ? (
              <>
                <span className="text-ink-muted">Managers: </span>
                <span className="font-semibold">
                  {talent.managers.map((item) => item.profile.full_name).join(', ')}
                </span>
              </>
            ) : (
              <Badge tone="warning">Manager needed</Badge>
            )}
          </p>
          {sendMessage && <p className="pt-1 text-sm text-ink-muted">{sendMessage}</p>}
        </div>
      </div>
{onEdit && (
      <div className="flex shrink-0 flex-wrap gap-2 self-start sm:self-center">
        <button
          type="button"
          onClick={() => void handleSendTemporaryPassword()}
          disabled={sending}
          className="btn-secondary"
        >
          <KeyRound className="h-4 w-4" aria-hidden="true" />
          {sending ? 'Sending...' : 'Send temporary password'}
        </button>
        {talent.profile.activated_at === null && <ResendInviteButton profileId={talent.profile.id} />}
        <button type="button" onClick={onEdit} className="btn-secondary">
          <Pencil className="h-4 w-4" aria-hidden="true" />
          Edit
        </button>
      </div>
      )}
    </article>
  );
}

