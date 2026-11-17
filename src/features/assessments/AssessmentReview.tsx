import { useState } from 'react';
import { Notice } from '@/components/Notice';
import { RATING_OPTIONS, type AnswerMap } from '@/features/assessments/assessmentModel';
import type { CompetencyRecord } from '@/lib/records';

type FormNotice = { tone: 'error' | 'info'; text: string };

type AssessmentReviewProps = {
  competencies: CompetencyRecord[];
  answers: AnswerMap;
  notice: FormNotice | null;
  submitting: boolean;
  onEdit: () => void;
  onSubmit: (copyRequested: boolean) => void;
};

export function AssessmentReview({ competencies, answers, notice, submitting, onEdit, onSubmit }: AssessmentReviewProps) {
  const [copyRequested, setCopyRequested] = useState(false);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-xl">Review your feedback</h2>
        <p className="text-sm leading-relaxed text-ink-muted">
          Check every rating and note. Once you submit, the form is locked. You can still change your responses later
          using the link in your confirmation email.
        </p>
      </div>

      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

      <ol className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
        {competencies.map((competency) => {
          const answer = answers[competency.sort_order];
          const ratingLabel = RATING_OPTIONS.find((option) => option.value === answer?.rating)?.label ?? 'Not rated';
          return (
            <li key={competency.id} className="grid gap-3 p-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-6">
              <div className="min-w-0 space-y-2">
                <p className="font-semibold">
                  <span className="text-ink-muted">{competency.sort_order}.</span> {competency.name}
                </p>
                <p className="whitespace-pre-wrap text-sm leading-relaxed">{answer?.note}</p>
              </div>
              <p className="text-sm font-semibold sm:text-right">{ratingLabel}</p>
            </li>
          );
        })}
      </ol>

      <label className="flex items-center gap-3 text-sm font-semibold">
        <input
          type="checkbox"
          checked={copyRequested}
          disabled={submitting}
          onChange={(event) => setCopyRequested(event.target.checked)}
          className="h-4 w-4 accent-primary"
        />
        Email me a copy of my responses
      </label>

      <div className="flex flex-wrap justify-end gap-3">
        <button type="button" onClick={onEdit} disabled={submitting} className="btn-secondary">
          Edit responses
        </button>
        <button type="button" onClick={() => onSubmit(copyRequested)} disabled={submitting} className="btn-primary">
          {submitting ? 'Submitting...' : 'Submit feedback'}
        </button>
      </div>
    </div>
  );
}
