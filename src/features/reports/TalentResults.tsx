import { useState } from 'react';
import { Clock3, FileText } from 'lucide-react';
import { useAuth } from '@/auth/useAuth';
import { Badge } from '@/components/Badge';
import { Notice } from '@/components/Notice';
import { ReportPage } from '@/features/reports/ReportPage';
import { supabase } from '@/lib/supabase';
import { useAsyncData } from '@/lib/useAsyncData';

type TalentCycle = {
  cycleId: string;
  talentId: string;
  cycleName: string;
  closed: boolean;
  closesAt: string;
};

type CycleRef = { name: string; status: string; closes_at: string };

type SelfAssignmentRow = {
  talent_id: string;
  cycle_id: string;
  cycles: CycleRef | CycleRef[] | null;
};

function cycleOf(row: SelfAssignmentRow): CycleRef | null {
  return Array.isArray(row.cycles) ? (row.cycles[0] ?? null) : row.cycles;
}

function isClosed(status: string, closesAt: string): boolean {
  return status === 'closed' || (status === 'open' && Date.parse(closesAt) <= Date.now());
}

async function loadTalentCycles(): Promise<TalentCycle[]> {
  const { data, error } = await supabase
    .from('assignments')
    .select('talent_id, cycle_id, cycles(name, status, closes_at)')
    .eq('classification', 'self');
  if (error) throw new Error(`Could not load your cycles: ${error.message}`);

  const cycles: TalentCycle[] = [];
  for (const row of (data ?? []) as SelfAssignmentRow[]) {
    const cycle = cycleOf(row);
    if (!cycle) continue;
    cycles.push({
      cycleId: row.cycle_id,
      talentId: row.talent_id,
      cycleName: cycle.name,
      closed: isClosed(cycle.status, cycle.closes_at),
      closesAt: cycle.closes_at,
    });
  }
  return cycles.sort((a, b) => Date.parse(b.closesAt) - Date.parse(a.closesAt));
}

export function TalentResults() {
  const { state, reload } = useAsyncData(loadTalentCycles);
  const { state: auth } = useAuth();
  // Administrators can see a report while its cycle is still open; everyone else waits for the cycle to close.
  const isAdmin = auth.status === 'signed_in' && auth.profile.role === 'admin';
  const [openReport, setOpenReport] = useState<{ cycleId: string; talentId: string } | null>(null);

  if (openReport) {
    return <ReportPage cycleId={openReport.cycleId} talentId={openReport.talentId} onBack={() => setOpenReport(null)} />;
  }

  if (state.status === 'loading') return <p className="text-sm text-ink-muted">Loading your results...</p>;
  if (state.status === 'error') {
    return (
      <Notice>
        We could not load your results.{' '}
        <button type="button" onClick={reload} className="font-semibold underline underline-offset-4">
          Try again
        </button>
      </Notice>
    );
  }
  if (state.data.length === 0) return <NothingYet />;

  return (
    <ul className="space-y-3">
      {state.data.map((cycle) => (
        <li key={cycle.cycleId}>
          <CycleResultRow
            cycle={cycle}
            early={isAdmin}
            onOpen={() => setOpenReport({ cycleId: cycle.cycleId, talentId: cycle.talentId })}
          />
        </li>
      ))}
    </ul>
  );
}

function CycleResultRow({ cycle, onOpen, early }: { cycle: TalentCycle; onOpen: () => void; early: boolean }) {
  return (
    <article className="flex flex-col gap-4 rounded-card border border-line bg-surface p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 space-y-2">
        <p className="truncate font-semibold">{cycle.cycleName}</p>
        <Badge tone={cycle.closed ? 'success' : 'neutral'}>{cycle.closed ? 'Results ready' : 'Still open'}</Badge>
      </div>
      {cycle.closed ? (
        <button type="button" onClick={onOpen} className="btn-primary shrink-0">
          <FileText className="h-4 w-4" aria-hidden="true" />
          View my report
        </button>
      ) : early ? (
        <button type="button" onClick={onOpen} className="btn-secondary shrink-0">
          <FileText className="h-4 w-4" aria-hidden="true" />
          View my report so far
        </button>
      ) : (
        <p className="text-sm text-ink-muted">Your report opens when the cycle closes.</p>
      )}
    </article>
  );
}

function NothingYet() {
  return (
    <section className="rounded-card border border-dashed border-line bg-surface p-6 sm:p-8">
      <div className="flex items-start gap-4">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-muted text-primary">
          <Clock3 className="h-6 w-6" aria-hidden="true" />
        </span>
        <div className="min-w-0 space-y-1">
          <h2 className="text-lg">Nothing to show yet</h2>
          <p className="text-sm leading-relaxed text-ink-muted">
            Your results will appear here once your review cycle has closed and the summary is ready.
          </p>
        </div>
      </div>
    </section>
  );
}
