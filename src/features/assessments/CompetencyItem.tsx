import type { Answer } from '@/features/assessments/assessmentModel';
import { FormField } from '@/components/FormField';
import { RATING_OPTIONS } from '@/features/assessments/assessmentModel';
import type { CompetencyRecord } from '@/lib/records';

type CompetencyItemProps = {
  competency: CompetencyRecord;
  answer: Answer | undefined;
  flagged: boolean;
  readOnly: boolean;
  onChange: (change: Partial<Answer>) => void;
};

export function CompetencyItem({ competency, answer, flagged, readOnly, onChange }: CompetencyItemProps) {
  const number = competency.sort_order;
  const rating = answer?.rating ?? null;
  const note = answer?.note ?? '';
  const ratingMissing = flagged && rating === null;
  const noteMissing = flagged && note.trim() === '';

  const problem =
    ratingMissing && noteMissing
      ? 'Choose a rating and add a behaviour example.'
      : ratingMissing
        ? 'Choose a rating.'
        : noteMissing
          ? 'Add a behaviour example.'
          : null;

  return (
    <li
      id={`competency-${number}`}
      className={`scroll-mt-32 space-y-5 rounded-card border bg-surface p-5 transition-colors duration-200 sm:p-6 ${
        flagged ? 'border-danger ring-2 ring-danger' : 'border-line'
      }`}
    >
      <div className="flex items-start gap-4">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted text-sm font-semibold">
          {number}
        </span>
        <div className="min-w-0 space-y-1">
          <h3 className="text-base font-semibold">{competency.name}</h3>
          <p className="text-sm leading-relaxed text-ink-muted">{competency.definition}</p>
        </div>
      </div>

      <FormField id={`rating-${number}`} label="Rating">
        <select
          id={`rating-${number}`}
          className="field-input sm:max-w-xs"
          value={rating ?? ''}
          disabled={readOnly}
          onChange={(event) => onChange({ rating: event.target.value === '' ? null : Number(event.target.value) })}
        >
          <option value="">Select...</option>
          {RATING_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </FormField>

      <FormField id={`note-${number}`} label="Observable behaviour" hint="What did you see this person do?">
        <textarea
          id={`note-${number}`}
          className="field-input min-h-[7rem] resize-y leading-relaxed"
          rows={4}
          required
          aria-required="true"
          maxLength={2000}
          value={note}
          disabled={readOnly}
          onChange={(event) => onChange({ note: event.target.value })}
        />
      </FormField>

      {problem && (
        <p role="alert" className="text-sm font-semibold text-danger">
          {problem}
        </p>
      )}
    </li>
  );
}
