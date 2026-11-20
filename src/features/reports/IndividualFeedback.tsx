import { useCallback } from 'react';
import { Notice } from '@/components/Notice';
import { loadIndividualFeedback, type FeedbackRow } from '@/features/reports/reportSharing';
import { CLASSIFICATION_LABELS } from '@/lib/format';
import type { Classification } from '@/lib/records';
import { useAsyncData } from '@/lib/useAsyncData';

type Assessor = { label: string; name: string | null; classification: string; rows: FeedbackRow[] };

function groupByAssessor(rows: FeedbackRow[]): Assessor[] {
  const map = new Map<string, Assessor>();
  for (const row of rows) {
    const entry = map.get(row.assessor_label) ?? { label: row.assessor_label, name: row.assessor_name, classification: row.classification, rows: [] };
    entry.rows.push(row);
    map.set(row.assessor_label, entry);
  }
  return [...map.values()];
}

/**
 * Each assessor's answers. Administrators see every name; in a report shared with a manager,
 * names appear only for the immediate and skip-level managers' feedback (the server decides).
 */
export function IndividualFeedback({ cycleId, talentId }: { cycleId: string; talentId: string }) {
  const load = useCallback(() => loadIndividualFeedback(cycleId, talentId), [cycleId, talentId]);
  const { state, reload } = useAsyncData(load);

  if (state.status === 'loading') return <p className="text-sm text-ink-muted">Loading individual feedback...</p>;
  if (state.status === 'error') {
    return (
      <Notice>
        We could not load the individual feedback.{' '}
        <button type="button" onClick={reload} className="font-semibold underline underline-offset-4">
          Try again
        </button>
      </Notice>
    );
  }
  const assessors = groupByAssessor(state.data);
  if (assessors.length === 0) return <p className="text-sm text-ink-muted">No submitted feedback to show yet.</p>;

  return (
    <div className="space-y-4">
      <p className="text-xs text-ink-muted">
        Peer and direct-report feedback stays anonymous outside administration, and groups smaller than the cycle’s minimum
        size are left out of shared reports.
      </p>
      {assessors.map((a) => (
        <section key={a.label} className="overflow-hidden rounded-card border border-line bg-surface">
          <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line bg-muted px-4 py-3">
            <h3 className="text-base">{a.name ?? a.label}</h3>
            <span className="text-xs font-semibold text-ink-muted">
              {CLASSIFICATION_LABELS[a.classification as Classification] ?? a.classification}
              {a.name ? ` · ${a.label}` : ''}
            </span>
          </header>
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-ink-muted">
              <tr>
                <th className="px-4 py-2 font-semibold">Competency</th>
                <th className="w-16 px-2 py-2 text-center font-semibold">Rating</th>
                <th className="px-4 py-2 font-semibold">Behaviour note</th>
              </tr>
            </thead>
            <tbody>
              {a.rows.map((row) => (
                <tr key={row.competency_id} className="border-t border-line align-top">
                  <td className="px-4 py-2">
                    <span className="block font-semibold">{row.competency_name}</span>
                    <span className="block text-xs text-ink-muted">{row.category}</span>
                  </td>
                  <td className="px-2 py-2 text-center font-semibold tabular-nums">{row.rating}</td>
                  <td className="px-4 py-2 text-ink-muted">{row.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}
