import { useCallback } from 'react';
import { Notice } from '@/components/Notice';
import { AssessmentForm } from '@/features/assessments/AssessmentForm';
import { loadAssessmentDetail } from '@/features/assessments/assessmentQueries';
import { useAsyncData } from '@/lib/useAsyncData';

type AssessmentViewProps = {
  assignmentId: string;
  onBack: () => void;
};

export function AssessmentView({ assignmentId, onBack }: AssessmentViewProps) {
  const load = useCallback(() => loadAssessmentDetail(assignmentId), [assignmentId]);
  const { state, reload } = useAsyncData(load);

  if (state.status === 'loading') return <p className="text-sm text-ink-muted">Loading your feedback...</p>;

  if (state.status === 'error') {
    return (
      <div className="space-y-4">
        <Notice>
          We could not load this feedback.{' '}
          <button type="button" onClick={reload} className="font-semibold underline underline-offset-4">
            Try again
          </button>
        </Notice>
        <button type="button" onClick={onBack} className="btn-secondary">
          Back to my assessments
        </button>
      </div>
    );
  }

  if (!state.data) {
    return (
      <div className="space-y-4">
        <Notice>This assessment could not be found.</Notice>
        <button type="button" onClick={onBack} className="btn-secondary">
          Back to my assessments
        </button>
      </div>
    );
  }

  return <AssessmentForm detail={state.data} onBack={onBack} />;
}
