import { useEffect, useRef, useState } from 'react';
import { Notice } from '@/components/Notice';
import { reopenAssessment } from '@/features/assessments/assessmentActions';

type ReopenAssessmentProps = {
  token: string;
  onOpened: (assignmentId: string) => void;
  onBack: () => void;
};

export function ReopenAssessment({ token, onOpened, onBack }: ReopenAssessmentProps) {
  const [failure, setFailure] = useState<string | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    window.history.replaceState(null, '', '/');
    void reopenAssessment(token).then((result) => {
      if (result.ok) {
        onOpened(result.data.assignment_id);
      } else {
        setFailure(result.message);
      }
    });
  }, [token, onOpened]);

  return (
    <section className="mx-auto max-w-xl space-y-6 rounded-card border border-line bg-surface p-6 sm:p-8">
      <div className="space-y-2">
        <h1 className="text-2xl">Edit your feedback</h1>
        {failure ? null : <p className="text-sm text-ink-muted" role="status">Opening your feedback...</p>}
      </div>
      {failure && (
        <div className="space-y-5">
          <Notice>{failure}</Notice>
          <button type="button" onClick={onBack} className="btn-primary">
            Go to my assessments
          </button>
        </div>
      )}
    </section>
  );
}
