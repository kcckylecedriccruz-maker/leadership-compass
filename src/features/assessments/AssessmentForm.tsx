import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Eraser, Save, Send } from 'lucide-react';
import { Badge } from '@/components/Badge';
import { Notice } from '@/components/Notice';
import { AssessmentReview } from '@/features/assessments/AssessmentReview';
import { CompetencyItem } from '@/features/assessments/CompetencyItem';
import {
  ASSIGNMENT_STATUS_TONES,
  countAnswered,
  groupCompetencies,
  ITEM_COUNT,
  listItemNumbers,
  partiallyAnsweredNumbers,
  toDraftPayload,
  toSubmitPayload,
  type Answer,
  type AnswerMap,
} from '@/features/assessments/assessmentModel';
import type { AssessmentDetail } from '@/features/assessments/assessmentQueries';
import {
  clearAssessmentDraft,
  missingItemNumbers,
  saveAssessmentDraft,
  submitAssessment,
  type ActionResult,
} from '@/features/assessments/assessmentActions';
import type { SubmitItem } from '@/features/assessments/assessmentModel';
import type { FunctionResult } from '@/lib/edgeFunctions';
import { ASSIGNMENT_STATUS_LABELS, daysLeftLabel } from '@/lib/format';
import type { AssignmentStatus } from '@/lib/records';

type FormNotice = { tone: 'error' | 'info'; text: string };

function draftSavedMessage(incomplete: number[]): string {
  if (incomplete.length === 0) return 'Draft saved. You can come back and change your responses at any time.';
  const list = listItemNumbers(incomplete);
  return incomplete.length === 1
    ? `Draft saved. Item ${list} is still incomplete and needs both a rating and a behaviour example before you can submit.`
    : `Draft saved. Items ${list} are still incomplete and each needs both a rating and a behaviour example before you can submit.`;
}
type Pending = 'save' | 'clear' | 'submit' | null;
type Step = 'edit' | 'review';

const EMPTY_ANSWER: Answer = { rating: null, note: '' };

/** How the form saves and submits: signed in (default) or through a secure link. */
export type FormActions = {
  save: (items: SubmitItem[]) => Promise<ActionResult>;
  clear: () => Promise<ActionResult>;
  submit: (copyRequested: boolean, items: SubmitItem[]) => Promise<FunctionResult<unknown>>;
  /** Link users change a submitted form here instead of using the emailed edit link. */
  reopen?: () => Promise<ActionResult>;
};

type AssessmentFormProps = {
  detail: AssessmentDetail;
  onBack: () => void;
  actions?: FormActions;
  backLabel?: string;
};

export function AssessmentForm({ detail, onBack, actions, backLabel = 'Back to my assessments' }: AssessmentFormProps) {
  const { summary, competencies } = detail;
  const act: FormActions = actions ?? {
    save: (items) => saveAssessmentDraft(summary.id, items),
    clear: () => clearAssessmentDraft(summary.id),
    submit: (copyRequested, items) => submitAssessment(summary.id, copyRequested, items),
  };
  const [answers, setAnswers] = useState<AnswerMap>(detail.answers);
  const [status, setStatus] = useState<AssignmentStatus>(summary.status);
  const [step, setStep] = useState<Step>('edit');
  const [flagged, setFlagged] = useState<number[]>([]);
  const [scrollRequest, setScrollRequest] = useState<{ item: number } | null>(null);
  const [notice, setNotice] = useState<FormNotice | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [confirmingClear, setConfirmingClear] = useState(false);

  const groups = useMemo(() => groupCompetencies(competencies), [competencies]);
  const readOnly = status === 'submitted' || summary.cycle.status !== 'open';
  const answeredCount = countAnswered(answers);
  const allAnswered = answeredCount === ITEM_COUNT;
  const busy = pending !== null;
  const details = [summary.talent.department, summary.talent.position].filter(Boolean).join(' · ');

  useEffect(() => {
    if (!scrollRequest) return;
    document
      .getElementById(`competency-${scrollRequest.item}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [scrollRequest]);

  useEffect(() => {
    if (!confirmingClear) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setConfirmingClear(false);
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [confirmingClear]);

  function updateAnswer(number: number, change: Partial<Answer>) {
    setAnswers((previous) => ({
      ...previous,
      [number]: { ...(previous[number] ?? EMPTY_ANSWER), ...change },
    }));
    setFlagged((previous) => previous.filter((item) => item !== number));
  }

  async function saveDraft() {
    setPending('save');
    setNotice(null);
    const result = await act.save(toDraftPayload(answers));
    setPending(null);
    if (!result.ok) {
      setNotice({ tone: 'error', text: result.message });
      return;
    }
    setStatus('draft');
    const partial = partiallyAnsweredNumbers(answers);
    setNotice({ tone: 'info', text: draftSavedMessage(partial) });
  }

  async function clearDraft() {
    setPending('clear');
    setNotice(null);
    const result = await act.clear();
    setPending(null);
    setConfirmingClear(false);
    if (!result.ok) {
      setNotice({ tone: 'error', text: result.message });
      return;
    }
    setAnswers({});
    setFlagged([]);
    setStatus('not_started');
    setNotice({ tone: 'info', text: 'Your draft has been cleared.' });
  }

  async function submitFeedback(copyRequested: boolean) {
    setPending('submit');
    setNotice(null);
    const result = await act.submit(copyRequested, toSubmitPayload(answers));
    setPending(null);
    if (result.ok) {
      setStatus('submitted');
      setStep('edit');
      setFlagged([]);
      return;
    }
    setNotice({ tone: 'error', text: result.message });
    const missing = missingItemNumbers(result.payload);
    if (missing.length > 0) {
      setFlagged(missing);
      setStep('edit');
      setScrollRequest({ item: missing[0] });
    }
  }

  async function reopen() {
    if (!act.reopen) return;
    setPending('save');
    setNotice(null);
    const result = await act.reopen();
    setPending(null);
    if (!result.ok) {
      setNotice({ tone: 'error', text: result.message });
      return;
    }
    setStatus('draft');
  }

  return (
    <div className="space-y-8">
      <header className="space-y-4">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 text-sm font-semibold text-ink-muted transition-colors duration-200 hover:text-ink"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {backLabel}
        </button>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <h1 className="text-2xl sm:text-3xl">{summary.talent.full_name}</h1>
            {details && <p className="text-sm text-ink-muted">{details}</p>}
            <p className="text-sm text-ink-muted">
              {summary.cycle.name} · {daysLeftLabel(summary.cycle.closes_at)}
            </p>
          </div>
          <Badge tone={ASSIGNMENT_STATUS_TONES[status]}>{ASSIGNMENT_STATUS_LABELS[status]}</Badge>
        </div>
      </header>

      {step === 'review' ? (
        <AssessmentReview
          competencies={competencies}
          answers={answers}
          notice={notice}
          submitting={pending === 'submit'}
          onEdit={() => {
            setNotice(null);
            setStep('edit');
          }}
          onSubmit={(copyRequested) => void submitFeedback(copyRequested)}
        />
      ) : (
        <>
          {status === 'submitted' && (
            <Notice tone="info">
              {act.reopen
                ? 'Thank you. Your feedback has been submitted. You can still change it until the cycle closes.'
                : 'Thank you. Your feedback has been submitted. To change it, use the Edit my responses link in your confirmation email before the cycle closes.'}
            </Notice>
          )}
          {status === 'submitted' && notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
          {status !== 'submitted' && summary.cycle.status !== 'open' && (
            <Notice tone="info">This cycle has closed, so this feedback is read-only.</Notice>
          )}
          {!readOnly && (
            <Notice tone="info">
              Peer and Direct report ratings are anonymous. Immediate manager and Self ratings are not.
            </Notice>
          )}

          <div className="space-y-10">
            {groups.map((group) => (
              <section key={group.category} aria-label={group.category} className="space-y-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line pb-3">
                  <h2 className="text-xl">{group.category}</h2>
                  <p className="text-sm text-ink-muted">
                    Items {group.competencies[0].sort_order} to{' '}
                    {group.competencies[group.competencies.length - 1].sort_order}
                  </p>
                </div>
                <ul className="space-y-4">
                  {group.competencies.map((competency) => (
                    <CompetencyItem
                      key={competency.id}
                      competency={competency}
                      answer={answers[competency.sort_order]}
                      flagged={flagged.includes(competency.sort_order)}
                      readOnly={readOnly}
                      onChange={(change) => updateAnswer(competency.sort_order, change)}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </div>

          {status === 'submitted' ? (
            <div className="flex flex-wrap justify-end gap-3">
              {act.reopen && summary.cycle.status === 'open' && (
                <button type="button" onClick={() => void reopen()} disabled={busy} className="btn-secondary">
                  Change my answers
                </button>
              )}
              <button type="button" onClick={onBack} className="btn-primary">
                {actions ? 'Back to my forms' : 'Assess another talent'}
              </button>
            </div>
          ) : (
            !readOnly && (
              <div className="sticky bottom-0 space-y-4 rounded-t-card border border-line bg-surface p-4 shadow-lg sm:p-5">
                {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm font-semibold">
                    {answeredCount} of {ITEM_COUNT} complete
                  </p>
                  <div className="flex flex-wrap items-center gap-3">
                    {confirmingClear ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm text-ink-muted">Clear this draft?</span>
                        <button
                          type="button"
                          onClick={() => setConfirmingClear(false)}
                          disabled={busy}
                          autoFocus
                          className="btn-secondary px-3 py-2"
                        >
                          Keep
                        </button>
                        <button
                          type="button"
                          onClick={() => void clearDraft()}
                          disabled={busy}
                          className="inline-flex items-center justify-center rounded-xl bg-danger px-3 py-2 text-sm font-semibold text-surface transition-opacity duration-200 hover:opacity-90 disabled:opacity-60"
                        >
                          {pending === 'clear' ? 'Clearing...' : 'Yes, clear'}
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmingClear(true)}
                        disabled={busy}
                        className="btn-secondary"
                      >
                        <Eraser className="h-4 w-4" aria-hidden="true" />
                        Clear
                      </button>
                    )}
                    <button type="button" onClick={() => void saveDraft()} disabled={busy} className="btn-secondary">
                      <Save className="h-4 w-4" aria-hidden="true" />
                      {pending === 'save' ? 'Saving...' : 'Save'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setNotice(null);
                        setStep('review');
                      }}
                      disabled={busy || !allAnswered}
                      className="btn-primary"
                    >
                      <Send className="h-4 w-4" aria-hidden="true" />
                      Review
                    </button>
                  </div>
                </div>
              </div>
            )
          )}
        </>
      )}
    </div>
  );
}
