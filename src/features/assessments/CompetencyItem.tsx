import { useState } from 'react';
import { HelpCircle, Loader2, Sparkles } from 'lucide-react';
import type { Answer } from '@/features/assessments/assessmentModel';
import { FormField } from '@/components/FormField';
import { RATING_OPTIONS } from '@/features/assessments/assessmentModel';
import type { AiResult, CoachResult } from '@/features/ai/aiApi';
import type { CompetencyRecord } from '@/lib/records';

type CompetencyItemProps = {
  competency: CompetencyRecord;
  answer: Answer | undefined;
  flagged: boolean;
  readOnly: boolean;
  onChange: (change: Partial<Answer>) => void;
  /** AI note coach ("Improve with AI"). */
  onCoach?: (note: string) => Promise<AiResult<CoachResult>>;
};

export function CompetencyItem({ competency, answer, flagged, readOnly, onChange, onCoach }: CompetencyItemProps) {
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
        <div className="min-w-0 flex-1 space-y-1">
          <h3 className="text-base font-semibold">{competency.name}</h3>
          <p className="text-sm leading-relaxed text-ink-muted">{competency.definition}</p>
          {competency.help && <HelpPanel help={competency.help} />}
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

      {!readOnly && onCoach && <NoteCoach note={note} onCoach={onCoach} onUse={(text) => onChange({ note: text })} />}

      {problem && (
        <p role="alert" className="text-sm font-semibold text-danger">
          {problem}
        </p>
      )}
    </li>
  );
}

function HelpPanel({ help }: { help: NonNullable<CompetencyRecord['help']> }) {
  return (
    <details className="group mt-2 rounded-xl border border-line bg-muted/40 px-3 py-2 text-sm">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 font-semibold text-primary">
        <HelpCircle className="h-4 w-4" aria-hidden="true" />
        What does this mean?
      </summary>
      <div className="mt-2 space-y-2 leading-relaxed">
        {help.plain && <p>{help.plain}</p>}
        {help.looks_like.length > 0 && (
          <div>
            <p className="font-semibold">Looks like</p>
            <ul className="list-disc pl-5 text-ink-muted">
              {help.looks_like.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        )}
        {help.not_like.length > 0 && (
          <div>
            <p className="font-semibold">Doesn’t look like</p>
            <ul className="list-disc pl-5 text-ink-muted">
              {help.not_like.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        )}
        {help.think_about && (
          <p>
            <span className="font-semibold">Think about: </span>
            <span className="text-ink-muted">{help.think_about}</span>
          </p>
        )}
      </div>
    </details>
  );
}

function NoteCoach({
  note,
  onCoach,
  onUse,
}: {
  note: string;
  onCoach: (note: string) => Promise<AiResult<CoachResult>>;
  onUse: (text: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CoachResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    setResult(null);
    const response = await onCoach(note);
    setBusy(false);
    if (!response.ok) return setError(response.message);
    setResult(response.data);
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary disabled:opacity-50"
        onClick={() => void run()}
        disabled={busy || note.trim().length < 3}
        title={note.trim().length < 3 ? 'Write a few words first' : undefined}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Sparkles className="h-4 w-4" aria-hidden="true" />}
        {busy ? 'Checking...' : 'Improve with AI'}
      </button>
      {error && <p className="text-sm text-danger">{error}</p>}
      {result && (
        <div className="space-y-2 rounded-xl border border-primary/30 bg-primary/5 p-3 text-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">AI suggestion</p>
          {result.verdict === 'good' ? (
            <p>This example is already clear and specific.</p>
          ) : (
            <>
              {result.issues.length > 0 && (
                <ul className="list-disc pl-5 text-ink-muted">
                  {result.issues.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
              )}
              <p className="whitespace-pre-wrap rounded-lg bg-surface p-2 leading-relaxed">{result.suggestion}</p>
            </>
          )}
          {result.identifying_risk && (
            <p className="font-semibold text-band-developing">This may reveal who wrote it. Consider removing identifying details.</p>
          )}
          <div className="flex flex-wrap gap-2">
            {result.verdict !== 'good' && (
              <button
                type="button"
                className="btn-secondary px-3 py-1.5 text-xs"
                onClick={() => {
                  onUse(result.suggestion);
                  setResult(null);
                }}
              >
                Use this
              </button>
            )}
            <button type="button" className="btn-secondary px-3 py-1.5 text-xs" onClick={() => setResult(null)}>
              Dismiss
            </button>
          </div>
          <p className="text-xs text-ink-muted">Check it says what you mean before using it. Placeholders in [brackets] need your details.</p>
        </div>
      )}
    </div>
  );
}
