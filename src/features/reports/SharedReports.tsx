import { useCallback, useState } from 'react';
import { ArrowLeft, FileText } from 'lucide-react';
import { useAuth } from '@/auth/useAuth';
import { Badge } from '@/components/Badge';
import { Notice } from '@/components/Notice';
import { IndividualFeedback } from '@/features/reports/IndividualFeedback';
import { ReportPage } from '@/features/reports/ReportPage';
import { loadSharedWithMe, type ReportShare } from '@/features/reports/reportSharing';
import { useAsyncData } from '@/lib/useAsyncData';

/** Reports an administrator has shared with the signed-in manager. */
export function SharedReports() {
  const { state: auth } = useAuth();
  const userId = auth.status === 'signed_in' ? auth.profile.id : '';
  const load = useCallback(() => loadSharedWithMe(userId), [userId]);
  const { state, reload } = useAsyncData(load);
  const [open, setOpen] = useState<ReportShare | null>(null);

  if (open?.kind === 'consolidated') {
    return <ReportPage cycleId={open.cycle_id} talentId={open.talent_id} onBack={() => setOpen(null)} />;
  }
  if (open?.kind === 'individual') {
    return (
      <div className="space-y-6">
        <button
          type="button"
          onClick={() => setOpen(null)}
          className="inline-flex items-center gap-2 text-sm font-semibold text-ink-muted hover:text-ink"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back
        </button>
        <div>
          <p className="eyebrow">{open.cycle_name}</p>
          <h2 className="text-2xl">{open.talent_name}: individual feedback</h2>
        </div>
        <IndividualFeedback cycleId={open.cycle_id} talentId={open.talent_id} />
      </div>
    );
  }

  return (
    <section className="space-y-4" aria-labelledby="shared-heading">
      <h2 id="shared-heading" className="flex items-center gap-2 text-xl">
        <FileText className="h-5 w-5 text-primary" aria-hidden="true" />
        Reports shared with you
      </h2>
      {state.status === 'loading' && <p className="text-sm text-ink-muted">Loading...</p>}
      {state.status === 'error' && (
        <Notice>
          We could not load shared reports.{' '}
          <button type="button" onClick={reload} className="font-semibold underline underline-offset-4">
            Try again
          </button>
        </Notice>
      )}
      {state.status === 'ready' && state.data.length === 0 && (
        <p className="text-sm text-ink-muted">No reports have been shared with you yet. Administrators decide what to share.</p>
      )}
      {state.status === 'ready' && state.data.length > 0 && (
        <ul className="space-y-2">
          {state.data.map((share) => (
            <li key={share.id}>
              <button
                type="button"
                onClick={() => setOpen(share)}
                className="flex w-full items-center gap-3 rounded-card border border-line bg-surface p-4 text-left hover:border-primary"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{share.talent_name}</span>
                  <span className="block truncate text-xs text-ink-muted">{share.cycle_name}</span>
                </span>
                <Badge tone="neutral">{share.kind === 'individual' ? 'Individual' : 'Consolidated'}</Badge>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
