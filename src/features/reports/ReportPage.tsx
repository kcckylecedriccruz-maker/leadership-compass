import { useCallback, useState } from 'react';
import { ArrowLeft, Copy, Printer } from 'lucide-react';
import { useAuth } from '@/auth/useAuth';
import { Notice } from '@/components/Notice';
import { AiSummary } from '@/features/ai/AiSummary';
import { IndividualFeedback } from '@/features/reports/IndividualFeedback';
import { SharePanel } from '@/features/reports/SharePanel';
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

type AdminView = 'report' | 'ai' | 'individual' | 'share';

const ADMIN_VIEWS: { id: AdminView; label: string }[] = [
  { id: 'report', label: 'Consolidated report' },
  { id: 'ai', label: 'AI summary' },
  { id: 'individual', label: 'Individual feedback' },
  { id: 'share', label: 'Share with managers' },
];

export function ReportPage({ cycleId, talentId, onBack }: ReportPageProps) {
  const load = useCallback(() => loadReportData(cycleId, talentId), [cycleId, talentId]);
  const { state, reload } = useAsyncData(load);
  const { state: auth } = useAuth();
  // Only administrators see individual named feedback and can share reports.
  const isAdmin = auth.status === 'signed_in' && auth.profile.role === 'admin';
  const [view, setView] = useState<AdminView>('report');

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

      {isAdmin && (
        <div role="tablist" aria-label="Report views" className="flex gap-1 overflow-x-auto rounded-2xl bg-muted p-1 print:hidden">
          {ADMIN_VIEWS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={view === item.id}
              onClick={() => setView(item.id)}
              className={`flex-1 whitespace-nowrap rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors ${
                view === item.id ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted hover:text-ink'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
      {isAdmin && view === 'ai' && <AiSummary cycleId={cycleId} talentId={talentId} />}
      {isAdmin && view === 'individual' && <IndividualFeedback cycleId={cycleId} talentId={talentId} />}
      {isAdmin && view === 'share' && <SharePanel cycleId={cycleId} talentId={talentId} />}

      {(!isAdmin || view === 'report') && (
        <>
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
        </>
      )}
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
