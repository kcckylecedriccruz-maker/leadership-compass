import { useCallback, useState } from 'react';
import { Badge, type BadgeTone } from '@/components/Badge';
import { Notice } from '@/components/Notice';
import { ReportPage } from '@/features/reports/ReportPage';
import { formatScore } from '@/features/reports/reportFormat';
import {
  loadCycleOptions,
  loadReadinessRows,
  type CycleOption,
  type ReadinessRow,
} from '@/features/reports/reportData';
import { useAsyncData } from '@/lib/useAsyncData';
import { FileText } from 'lucide-react';

const STATUS_TONE: Record<string, BadgeTone> = {
  Ready: 'success',
  Developing: 'warning',
  'Not yet ready': 'warning',
  'Insufficient feedback': 'neutral',
};

type OpenReport = { cycleId: string; talentId: string } | null;

const CATEGORY_TITLES: Record<ReadinessRow['category'], { title: string; note: string | null }> = {
  employee: { title: 'Employees', note: null },
  outside: { title: 'Outside people', note: 'Contractors, partners or client contacts evaluated by employees. No self-assessment.' },
  deleted: { title: 'Deleted people', note: 'Accounts that were deleted. Names were removed; their reports are kept here.' },
};

export function DashboardPanel() {
  const { state, reload } = useAsyncData(loadCycleOptions);
  const [selectedCycleId, setSelectedCycleId] = useState<string | null>(null);
  const [openReport, setOpenReport] = useState<OpenReport>(null);

  if (openReport) {
    return <ReportPage cycleId={openReport.cycleId} talentId={openReport.talentId} onBack={() => setOpenReport(null)} />;
  }

  return (
    <section className="space-y-6" aria-labelledby="dashboard-heading">
      <div className="space-y-1">
        <h2 id="dashboard-heading" className="text-2xl">
          Dashboard
        </h2>
        <p className="text-sm leading-relaxed text-ink-muted">
          Each talent in a cycle, ranked by overall gap so the greatest support needs appear first.
        </p>
      </div>

      {state.status === 'loading' && <p className="text-sm text-ink-muted">Loading cycles...</p>}
      {state.status === 'error' && (
        <Notice>
          We could not load cycles.{' '}
          <button type="button" onClick={reload} className="font-semibold underline underline-offset-4">
            Try again
          </button>
        </Notice>
      )}
      {state.status === 'ready' && state.data.length === 0 && (
        <div className="rounded-card border border-dashed border-line bg-surface p-8 text-center">
          <p className="font-semibold">No cycles yet</p>
          <p className="mt-1 text-sm text-ink-muted">Once a cycle is set up, its talents will appear here.</p>
        </div>
      )}
      {state.status === 'ready' && state.data.length > 0 && (
        <CycleBoard
          cycles={state.data}
          selectedCycleId={selectedCycleId ?? state.data[0].id}
          onSelectCycle={setSelectedCycleId}
          onOpenReport={(talentId) => setOpenReport({ cycleId: selectedCycleId ?? state.data[0].id, talentId })}
        />
      )}
    </section>
  );
}

function CycleBoard({
  cycles,
  selectedCycleId,
  onSelectCycle,
  onOpenReport,
}: {
  cycles: CycleOption[];
  selectedCycleId: string;
  onSelectCycle: (id: string) => void;
  onOpenReport: (talentId: string) => void;
}) {
  const load = useCallback(() => loadReadinessRows(selectedCycleId), [selectedCycleId]);
  const { state, reload } = useAsyncData(load);

  return (
    <div className="space-y-6">
      <label className="block max-w-sm space-y-2">
        <span className="text-sm font-semibold">Cycle</span>
        <select
          className="field-input"
          value={selectedCycleId}
          onChange={(event) => onSelectCycle(event.target.value)}
        >
          {cycles.map((cycle) => (
            <option key={cycle.id} value={cycle.id}>
              {cycle.name}
            </option>
          ))}
        </select>
      </label>

      {state.status === 'loading' && <p className="text-sm text-ink-muted">Loading talents...</p>}
      {state.status === 'error' && (
        <Notice>
          We could not load this cycle.{' '}
          <button type="button" onClick={reload} className="font-semibold underline underline-offset-4">
            Try again
          </button>
        </Notice>
      )}
      {state.status === 'ready' && state.data.length === 0 && (
        <p className="text-sm text-ink-muted">No talents are assessed in this cycle yet.</p>
      )}
      {state.status === 'ready' &&
        (['employee', 'outside', 'deleted'] as const).map((category) => {
          const rows = state.data.filter((row) => (row.category ?? 'employee') === category);
          if (rows.length === 0) return null;
          const heading = CATEGORY_TITLES[category];
          return (
            <section key={category} className="space-y-3" aria-label={heading.title}>
              {(category !== 'employee' || state.data.some((row) => row.category !== 'employee')) && (
                <div className="space-y-0.5 pt-2">
                  <h3 className="text-lg">
                    {heading.title} <span className="text-sm font-normal text-ink-muted">({rows.length})</span>
                  </h3>
                  {heading.note && <p className="text-xs text-ink-muted">{heading.note}</p>}
                </div>
              )}
              <ul className="space-y-3">
                {rows.map((row) => (
                  <li key={row.talent_id}>
                    <TalentReadinessRow row={row} onOpen={() => onOpenReport(row.talent_id)} />
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
    </div>
  );
}

function TalentReadinessRow({ row, onOpen }: { row: ReadinessRow; onOpen: () => void }) {
  return (
    <article className="flex flex-col gap-4 rounded-card border border-line bg-surface p-5 transition-shadow duration-200 hover:shadow-md sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-ink-muted">#{row.rank}</span>
          <p className="truncate font-semibold">{row.talent_name}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
          <Badge tone={STATUS_TONE[row.status] ?? 'neutral'}>{row.status}</Badge>
          <span>Overall gap {formatScore(row.overall_gap)}</span>
        </div>
      </div>
      <button type="button" onClick={onOpen} className="btn-secondary shrink-0 self-start sm:self-center">
        <FileText className="h-4 w-4" aria-hidden="true" />
        Report
      </button>
    </article>
  );
}
