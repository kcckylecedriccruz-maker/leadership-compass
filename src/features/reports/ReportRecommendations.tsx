import type { NoteRow } from '@/features/reports/reportData';
import type { Recommendations } from '@/features/reports/recommendations';
import { TIMELINE } from '@/features/reports/recommendations';
import { formatScore } from '@/features/reports/reportFormat';

const CLASSIFICATION_LABELS: Record<string, string> = {
  self: 'Self',
  immediate_manager: 'Manager',
  peer: 'Peer',
  direct_report: 'Direct report',
};

export function ReportNotes({ notes }: { notes: NoteRow[] }) {
  if (notes.length === 0) {
    return <p className="text-sm text-ink-muted">No behaviour notes are available yet.</p>;
  }
  const byCompetency = new Map<string, { name: string; rows: NoteRow[] }>();
  for (const note of notes) {
    const entry = byCompetency.get(note.competency_id) ?? { name: note.competency_name, rows: [] };
    entry.rows.push(note);
    byCompetency.set(note.competency_id, entry);
  }
  return (
    <div className="space-y-6">
      {[...byCompetency.entries()].map(([id, entry]) => (
        <section key={id} className="space-y-3">
          <h3 className="text-base font-semibold">{entry.name}</h3>
          <ul className="space-y-3">
            {entry.rows.map((row, index) => (
              <li key={`${id}-${index}`} className="rounded-2xl bg-muted px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                  {CLASSIFICATION_LABELS[row.classification] ?? 'Assessor'}
                </p>
                <p className="mt-1 text-sm leading-relaxed">{row.note}</p>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export function ReportRecommendations({ recommendations }: { recommendations: Recommendations }) {
  const { focusAreas, blindSpots, strengths } = recommendations;
  return (
    <div className="space-y-10">
      <section className="space-y-4">
        <h3 className="text-lg">Focus areas</h3>
        {focusAreas.length === 0 ? (
          <p className="text-sm text-ink-muted">
            Not enough feedback from others to choose focus areas yet. Focus areas appear once Others scores are shown.
          </p>
        ) : (
          focusAreas.map((area) => (
            <article key={area.score.competency_id} className="space-y-4 rounded-card border border-line bg-surface p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h4 className="text-base font-semibold">{area.score.competency_name}</h4>
                <span className="text-sm text-ink-muted">Others {formatScore(area.score.others_score)}</span>
              </div>
              <p className="text-sm leading-relaxed text-ink-muted">Why chosen: {area.reason}</p>
              {area.action ? (
                <div className="grid gap-3 sm:grid-cols-3">
                  <ActionCell label="On the job (70%)" text={area.action.on_the_job} />
                  <ActionCell label="Coaching and feedback (20%)" text={area.action.coaching} />
                  <ActionCell label="Learning (10%)" text={area.action.learning} />
                </div>
              ) : null}
              <p className="text-sm leading-relaxed">
                <span className="font-semibold">Measure of success: </span>
                {area.action?.measure ?? 'Agree a measure with your manager.'}
              </p>
            </article>
          ))
        )}
      </section>

      <section className="space-y-4">
        <h3 className="text-lg">Blind spots</h3>
        {blindSpots.length === 0 ? (
          <p className="text-sm text-ink-muted">No blind spots were found in this cycle.</p>
        ) : (
          <ul className="space-y-2">
            {blindSpots.map((row) => (
              <li key={row.competency_id} className="text-sm leading-relaxed">
                <span className="font-semibold">{row.competency_name}</span>: you rated yourself{' '}
                {formatScore(row.self_score)} and others rated you {formatScore(row.others_score)}.
              </li>
            ))}
          </ul>
        )}
        <p className="text-sm leading-relaxed text-ink-muted">
          Ask two raters to share a specific example of this behaviour, then re-rate after 30 days to see whether the
          gap has narrowed.
        </p>
      </section>

      <section className="space-y-4">
        <h3 className="text-lg">Strengths to leverage</h3>
        {strengths.length === 0 ? (
          <p className="text-sm text-ink-muted">No strengths are shown until Others scores are available.</p>
        ) : (
          <ul className="space-y-2">
            {strengths.map((row) => (
              <li key={row.competency_id} className="text-sm leading-relaxed">
                <span className="font-semibold">{row.competency_name}</span> (Others {formatScore(row.others_score)})
              </li>
            ))}
          </ul>
        )}
        <p className="text-sm leading-relaxed text-ink-muted">
          Mentor a peer in one of these strengths, or lead a project that builds one of your focus areas.
        </p>
      </section>

      <section className="space-y-4">
        <h3 className="text-lg">Timeline</h3>
        <ol className="space-y-3">
          {TIMELINE.map((step) => (
            <li key={step.days} className="flex gap-4">
              <span className="w-16 shrink-0 text-sm font-semibold text-primary">Day {step.days}</span>
              <span className="text-sm leading-relaxed">{step.text}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

function ActionCell({ label, text }: { label: string; text: string }) {
  return (
    <div className="rounded-2xl bg-muted p-4">
      <p className="text-xs font-semibold text-ink-muted">{label}</p>
      <p className="mt-2 text-sm leading-relaxed">{text}</p>
    </div>
  );
}
