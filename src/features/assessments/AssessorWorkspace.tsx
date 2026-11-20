import { useState } from 'react';
import { AssessmentList } from '@/features/assessments/AssessmentList';
import { AssessmentView } from '@/features/assessments/AssessmentView';
import { ReopenAssessment } from '@/features/assessments/ReopenAssessment';
import { MyPeersCard } from '@/features/org/MyPeersCard';
import type { Profile } from '@/lib/types';

const EDIT_PATH_PATTERN = /^\/edit\/([0-9a-f]{64})\/?$/i;

type View = { kind: 'list' } | { kind: 'assessment'; assignmentId: string } | { kind: 'reopen'; token: string };

function initialView(): View {
  const match = EDIT_PATH_PATTERN.exec(window.location.pathname);
  return match ? { kind: 'reopen', token: match[1] } : { kind: 'list' };
}

export function AssessorWorkspace({ profile }: { profile: Profile }) {
  const [view, setView] = useState<View>(initialView);

  function openList() {
    setView({ kind: 'list' });
  }

  function openAssessment(assignmentId: string) {
    setView({ kind: 'assessment', assignmentId });
  }

  switch (view.kind) {
    case 'list':
      return (
        <div className="space-y-10">
          <AssessmentList assessorId={profile.id} onOpen={openAssessment} />
          <MyPeersCard profile={profile} />
        </div>
      );
    case 'assessment':
      return <AssessmentView key={view.assignmentId} assignmentId={view.assignmentId} onBack={openList} />;
    case 'reopen':
      return <ReopenAssessment token={view.token} onOpened={openAssessment} onBack={openList} />;
  }
}
