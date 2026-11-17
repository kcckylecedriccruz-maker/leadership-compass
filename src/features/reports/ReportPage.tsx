import { useCallback, useState } from 'react';
import { ArrowLeft, Copy, Printer } from 'lucide-react';
import { Notice } from '@/components/Notice';
import { ReadinessSummary, ScoreTable } from '@/features/reports/ReportScores';
import { ReportNotes, ReportRecommendations } from '@/features/reports/ReportRecommendations';
import { buildRecommendations } from '@/features/reports/recommendations';
import { buildReportText } from '@/features/reports/reportText';
import { loadReportData, type ReportData } from '@/features/reports/reportData';
import { useAsyncData } from '@/lib/useAsyncData';

type ReportPageProps = {
  cycleId: string;
  talentId: string;
  onBack: () => void;
};

export function ReportPage({ cycleId, talentId, onBack }: ReportPageProps) {
  const load = useCallback(() => loadReportData(cycleId, talentId), [cycleId, talentId]);
  const { state, reload } = useAsyncData(load);

  return (
    <div className="space-y-8">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-2 text-sm font-semibold text-ink-muted transition-colors duration-200 hover:text-ink print:hidden"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back
      </button>

      {state.status === 'loading' && <p className="text-sm text-ink-muted">Loading report...</p>}
      {state.status === 'error' && (
        <Notice>
          We could not load this report.{' '}
          <button type="button" onClick={reload} className="font-semibold underline underline-offset-4">
            Try again
          </button>
        </Notice>
      )}
      {state.status === 'ready' && <ReportContent data={state.data} />}
    </div>
  );
}

function ReportContent({ data }: { data: ReportData }) {
  const [copied, setCopied] = useState(false);
  const recommendations = buildRecommendations(data.scores, data.actions);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(buildReportText(data, recommendations));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <article className="space-y-10 print:space-y-6">
      <p className="hidden text-sm font-semibold text-primary print:block">Leadership Compass</p>
      <header className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <p className="text-sm font-semibold text-primary">{data.cycle.name}</p>
          <h1 className="text-3xl sm:text-4xl">{data.talentName}</h1>
          <p className="text-sm text-ink-muted">Development report</p>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          <button type="button" onClick={() => void handleCopy()} className="btn-secondary">
            <Copy className="h-4 w-4" aria-hidden="true" />
            {copied ? 'Copied' : 'Copy report'}
          </button>
          <button type="button" onClick={() => window.print()} className="btn-primary">
            <Printer className="h-4 w-4" aria-hidden="true" />
            Print / Save as PDF
          </button>
        </div>
      </header>

      <ReadinessSummary readiness={data.readiness} />

      <section className="space-y-4" aria-labelledby="scores-heading">
        <h2 id="scores-heading" className="text-xl">
          Self and Others by competency
        </h2>
        <ScoreTable scores={data.scores} />
      </section>

      <section className="space-y-4" aria-labelledby="notes-heading">
        <h2 id="notes-heading" className="text-xl">
          Behaviour notes
        </h2>
        <p className="text-sm leading-relaxed text-ink-muted">
          Notes are shared without names. Peer and direct report notes appear only when enough people responded.
        </p>
        <ReportNotes notes={data.notes} />
      </section>

      <section className="space-y-4" aria-labelledby="recommendations-heading">
        <h2 id="recommendations-heading" className="text-xl">
          Recommendations
        </h2>
        <ReportRecommendations recommendations={recommendations} />
      </section>
    </article>
  );
}
