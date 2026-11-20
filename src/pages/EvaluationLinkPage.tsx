import { useCallback, useState } from 'react';
import { ChevronRight, Lock } from 'lucide-react';
import { Badge } from '@/components/Badge';
import { BrandMark } from '@/components/BrandMark';
import { Notice } from '@/components/Notice';
import { AssessmentForm } from '@/features/assessments/AssessmentForm';
import { ASSIGNMENT_STATUS_TONES } from '@/features/assessments/assessmentModel';
import { linkActions, loadLinkForm, openLink, type LinkAssessment, type LinkSession } from '@/features/link/linkApi';
import { ASSIGNMENT_STATUS_LABELS, daysLeftLabel } from '@/lib/format';
import { useAsyncData } from '@/lib/useAsyncData';

type Outcome<T> = { ok: true; value: T } | { ok: false; message: string };

/** Keeps the server's message (useAsyncData only reports that something failed). */
async function attempt<T>(run: () => Promise<T>): Promise<Outcome<T>> {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Something went wrong.' };
  }
}

/**
 * Private feedback page for people without an active account (quick-added employees, people who have not
 * activated yet, and external raters). The link in their email is their only credential.
 */
export function EvaluationLinkPage({ token }: { token: string }) {
  const load = useCallback(() => attempt(() => openLink(token)), [token]);
  const { state, reload } = useAsyncData(load);
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="min-h-screen bg-canvas">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <BrandMark compact />
          <span className="inline-flex items-center gap-1.5 text-xs text-ink-muted">
            <Lock className="h-3.5 w-3.5" aria-hidden="true" />
            Private feedback link
          </span>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
        {state.status === 'loading' && <p className="text-sm text-ink-muted">Opening your feedback forms...</p>}
        {(state.status === 'error' || (state.status === 'ready' && !state.data.ok)) && (
          <div className="space-y-3">
            <h1 className="text-2xl">This link cannot be opened</h1>
            <Notice>
              {state.status === 'ready' && !state.data.ok ? state.data.message : 'We could not reach the server. Try again.'}
            </Notice>
            <p className="text-sm text-ink-muted">
              Links work only for the person they were sent to, until the review cycle closes. The newest email has the
              current link.
            </p>
          </div>
        )}
        {state.status === 'ready' &&
          state.data.ok &&
          (openId ? (
            <LinkForm
              token={token}
              session={state.data.value}
              assessment={state.data.value.assessments.find((a) => a.id === openId)}
              onBack={() => {
                setOpenId(null);
                reload();
              }}
            />
          ) : (
            <FormList session={state.data.value} onOpen={setOpenId} />
          ))}
      </main>
    </div>
  );
}

function FormList({ session, onOpen }: { session: LinkSession; onOpen: (id: string) => void }) {
  const open = session.cycle.status === 'open';
  const remaining = session.assessments.filter((a) => a.status !== 'submitted').length;
  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <p className="eyebrow">{session.cycle.name}</p>
        <h1 className="text-3xl sm:text-4xl">Hello, {session.person.full_name.split(' ')[0]}</h1>
        <p className="max-w-2xl text-base leading-relaxed text-ink-muted">
          {open
            ? `${remaining === 0 ? 'All your forms are submitted. Thank you.' : `You have ${remaining} form${remaining === 1 ? '' : 's'} to complete.`} ${daysLeftLabel(session.cycle.closes_at)}.`
            : 'This review cycle has closed, so forms can no longer be changed.'}
        </p>
      </div>

      {open && (
        <Notice tone="info">
          Your answers save when you select Save, so you can come back with this same link. Please do not forward it.
        </Notice>
      )}

      {!open && session.person.person_type === 'employee' && (
        <Notice tone="info">
          Your own report is in the app. To see it,{' '}
          <a href="/activate" className="font-semibold underline underline-offset-4">
            activate your account
          </a>{' '}
          with your work email.
        </Notice>
      )}

      {session.assessments.length === 0 ? (
        <p className="text-sm text-ink-muted">There are no forms for you in this cycle.</p>
      ) : (
        <ul className="space-y-3">
          {session.assessments.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => onOpen(item.id)}
                className="flex w-full items-center gap-4 rounded-card border border-line bg-surface p-5 text-left transition-colors hover:border-primary"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">
                    {item.classification === 'self' ? 'Your self-assessment' : item.talent.full_name}
                  </span>
                  <span className="block truncate text-sm text-ink-muted">
                    {[item.talent.position, item.talent.department].filter(Boolean).join(' · ') || ' '}
                  </span>
                </span>
                <Badge tone={ASSIGNMENT_STATUS_TONES[item.status]}>{ASSIGNMENT_STATUS_LABELS[item.status]}</Badge>
                <ChevronRight className="h-5 w-5 shrink-0 text-ink-muted" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function LinkForm({
  token,
  session,
  assessment,
  onBack,
}: {
  token: string;
  session: LinkSession;
  assessment: LinkAssessment | undefined;
  onBack: () => void;
}) {
  const assignmentId = assessment?.id ?? '';
  const load = useCallback(() => attempt(() => loadLinkForm(token, assignmentId)), [token, assignmentId]);
  const { state } = useAsyncData(load);

  if (!assessment) return <Notice>This form could not be found.</Notice>;
  if (state.status === 'loading') return <p className="text-sm text-ink-muted">Loading the form...</p>;
  if (state.status === 'error' || !state.data.ok) {
    return (
      <div className="space-y-4">
        <Notice>{state.status === 'ready' && !state.data.ok ? state.data.message : 'We could not load this form.'}</Notice>
        <button type="button" onClick={onBack} className="btn-secondary">
          Back to my forms
        </button>
      </div>
    );
  }

  return (
    <AssessmentForm
      detail={{
        summary: {
          id: assessment.id,
          status: assessment.status,
          cycle: { id: session.cycle.id, name: session.cycle.name, closes_at: session.cycle.closes_at, status: session.cycle.status },
          talent: assessment.talent,
        },
        competencies: state.data.value.competencies,
        answers: state.data.value.answers,
      }}
      onBack={onBack}
      actions={linkActions(token, assessment.id)}
      backLabel="Back to my forms"
    />
  );
}
