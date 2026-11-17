import { Badge, type BadgeTone } from '@/components/Badge';
import type { ReadinessRow, ScoreRow } from '@/features/reports/reportData';
import { formatScore } from '@/features/reports/reportFormat';

const STATUS_TONE: Record<string, BadgeTone> = {
  Ready: 'success',
  Developing: 'warning',
  'Not yet ready': 'warning',
  'Insufficient feedback': 'neutral',
};

const CATEGORY_GAPS: { key: keyof ReadinessRow; label: string }[] = [
  { key: 'leading_self_gap', label: 'Leading Self' },
  { key: 'leading_others_gap', label: 'Leading Others' },
  { key: 'leading_business_gap', label: 'Leading the Business' },
  { key: 'leading_change_gap', label: 'Leading Change' },
];

export function ReadinessSummary({ readiness }: { readiness: ReadinessRow }) {
  return (
    <section className="space-y-5 rounded-card border border-line bg-surface p-6 sm:p-8" aria-labelledby="readiness-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="readiness-heading" className="text-xl">
          Readiness
        </h2>
        <Badge tone={STATUS_TONE[readiness.status] ?? 'neutral'}>{readiness.status}</Badge>
      </div>
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {CATEGORY_GAPS.map((item) => (
          <div key={item.key} className="rounded-2xl bg-muted p-4">
            <dt className="text-xs font-semibold text-ink-muted">{item.label}</dt>
            <dd className="mt-1 text-lg font-semibold">{formatScore(readiness[item.key] as number | null)}</dd>
            <dd className="text-xs text-ink-muted">gap</dd>
          </div>
        ))}
      </dl>
      <p className="text-sm leading-relaxed text-ink-muted">
        Overall gap {formatScore(readiness.overall_gap)}. Categories with a gap above 1.0:{' '}
        {readiness.categories_above_one}. A gap is 5 minus the Others score, averaged within each category.
      </p>
    </section>
  );
}

function groupByCategory(scores: ScoreRow[]): [string, ScoreRow[]][] {
  const groups = new Map<string, ScoreRow[]>();
  for (const row of scores) {
    const list = groups.get(row.category) ?? [];
    list.push(row);
    groups.set(row.category, list);
  }
  return [...groups.entries()];
}

export function ScoreTable({ scores }: { scores: ScoreRow[] }) {
  if (scores.length === 0) {
    return <p className="text-sm text-ink-muted">No scores are available yet.</p>;
  }
  return (
    <div className="space-y-8">
      {groupByCategory(scores).map(([category, rows]) => (
        <section key={category} className="space-y-3" aria-label={category}>
          <h3 className="text-lg">{category}</h3>
          <div className="overflow-x-auto rounded-card border border-line bg-surface">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="bg-muted text-xs uppercase tracking-wide text-ink-muted">
                <tr>
                  <th className="px-4 py-3 font-semibold">Competency</th>
                  <th className="px-3 py-3 text-right font-semibold">Self</th>
                  <th className="px-3 py-3 text-right font-semibold">Manager</th>
                  <th className="px-3 py-3 text-right font-semibold">Peers</th>
                  <th className="px-3 py-3 text-right font-semibold">Direct reports</th>
                  <th className="px-3 py-3 text-right font-semibold">Others</th>
                  <th className="px-4 py-3 font-semibold">Band</th>
                  <th className="px-4 py-3 font-semibold">Perception</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.competency_id} className="border-t border-line">
                    <td className="px-4 py-3 font-semibold">{row.competency_name}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{formatScore(row.self_score)}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{formatScore(row.manager_score)}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{formatScore(row.peer_score)}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{formatScore(row.direct_report_score)}</td>
                    <td className="px-3 py-3 text-right font-semibold tabular-nums">{formatScore(row.others_score)}</td>
                    <td className="px-4 py-3">{row.band ?? 'Not rated'}</td>
                    <td className="px-4 py-3 text-ink-muted">{row.perception ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
