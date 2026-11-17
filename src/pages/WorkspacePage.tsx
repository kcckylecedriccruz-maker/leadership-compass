import { useState } from 'react';
import { AuditTrailPanel } from '@/features/audit/AuditTrailPanel';
import { AssignmentsPanel } from '@/features/assignments/AssignmentsPanel';
import { CyclesPanel } from '@/features/cycles/CyclesPanel';
import { PeoplePanel } from '@/features/people/PeoplePanel';
import { DashboardPanel } from '@/features/reports/DashboardPanel';
import { TalentsPanel } from '@/features/talents/TalentsPanel';
import { UserControlPanel } from '@/features/users/UserControlPanel';
import { MODULE_LABELS, canEdit, canView, type Module, type Profile } from '@/lib/types';

type Section = Exclude<Module, 'settings'>;

const WORKSPACE_SECTIONS: Section[] = ['dashboard', 'cycles', 'people', 'talents', 'assignments', 'users', 'audit'];
const MANAGER_SECTIONS: Section[] = ['dashboard', 'assignments'];

export function WorkspacePage({ profile, mode }: { profile: Profile; mode: 'admin' | 'team' }) {
  const isWorkspace = mode === 'admin';
  // The workspace shows only the modules this person may view; a manager's team view keeps its two tabs.
  const sections = isWorkspace ? WORKSPACE_SECTIONS.filter((section) => canView(profile, section)) : MANAGER_SECTIONS;
  const [selected, setSelected] = useState<Section>(sections[0] ?? 'dashboard');
  const section = sections.includes(selected) ? selected : sections[0];
  const isAdmin = profile.role === 'admin';

  if (!section) {
    return <p className="text-sm text-ink-muted">You do not have access to any workspace modules yet.</p>;
  }

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <p className="eyebrow">{isWorkspace ? (isAdmin ? 'Administration' : 'Workspace') : 'Your team'}</p>
        <h1 className="text-3xl sm:text-4xl">{isWorkspace ? 'Set up the assessments' : 'Your assessments'}</h1>
      </div>

      <div role="tablist" aria-label="Workspace sections" className="flex gap-1 overflow-x-auto rounded-2xl bg-muted p-1">
        {sections.map((id) => {
          const isSelected = section === id;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={isSelected}
              onClick={() => setSelected(id)}
              className={`flex-1 whitespace-nowrap rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors duration-200 sm:px-4 ${
                isSelected ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted hover:text-ink'
              }`}
            >
              {MODULE_LABELS[id]}
              {isWorkspace && !canEdit(profile, id) && id !== 'dashboard' && id !== 'audit' && (
                <span className="ml-1.5 text-xs font-normal text-ink-muted">(view)</span>
              )}
            </button>
          );
        })}
      </div>

      {section === 'dashboard' && <DashboardPanel />}
      {section === 'cycles' && <CyclesPanel canEdit={canEdit(profile, 'cycles')} />}
      {section === 'people' && (
        <PeoplePanel canEdit={canEdit(profile, 'people') && canEdit(profile, 'talents')} canManageNotifications={isAdmin} />
      )}
      {section === 'talents' && <TalentsPanel canEdit={canEdit(profile, 'talents')} />}
      {section === 'assignments' &&
        (isWorkspace ? (
          <AssignmentsPanel isAdmin={canEdit(profile, 'assignments')} canAdd={canEdit(profile, 'assignments')} />
        ) : (
          <AssignmentsPanel isAdmin={false} canAdd managerId={profile.id} />
        ))}
      {section === 'users' && <UserControlPanel currentUser={profile} canEdit={canEdit(profile, 'users')} />}
      {section === 'audit' && <AuditTrailPanel />}
    </div>
  );
}
