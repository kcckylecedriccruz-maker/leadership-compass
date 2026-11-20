import { useState } from 'react';
import { AuditTrailPanel } from '@/features/audit/AuditTrailPanel';
import { AssignmentsPanel } from '@/features/assignments/AssignmentsPanel';
import { CyclesPanel } from '@/features/cycles/CyclesPanel';
import { InsightsPanel } from '@/features/ai/InsightsPanel';
import { OrgStructurePanel } from '@/features/org/OrgStructurePanel';
import { DashboardPanel } from '@/features/reports/DashboardPanel';
import { UserControlPanel } from '@/features/users/UserControlPanel';
import { MODULE_LABELS, canEdit, canView, type Module, type Profile } from '@/lib/types';

// The Org structure tab uses the 'talents' module key, so existing module access carries over.
// Insights (AI) is for administrators only and is not a grantable module.
type Section = Exclude<Module, 'settings' | 'people'> | 'insights';

const WORKSPACE_SECTIONS: Exclude<Section, 'insights'>[] = ['dashboard', 'cycles', 'talents', 'assignments', 'users', 'audit'];

export function WorkspacePage({ profile }: { profile: Profile; mode?: 'admin' }) {
  const isAdminUser = profile.role === 'admin';
  const sections: Section[] = [
    ...WORKSPACE_SECTIONS.filter((section) => canView(profile, section as Module)),
    ...(isAdminUser ? (['insights'] as Section[]) : []),
  ];
  const [selected, setSelected] = useState<Section>(sections[0] ?? 'dashboard');
  const section = sections.includes(selected) ? selected : sections[0];
  const isAdmin = profile.role === 'admin';

  if (!section) {
    return <p className="text-sm text-ink-muted">You do not have access to any workspace modules yet.</p>;
  }

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <p className="eyebrow">{isAdmin ? 'Administration' : 'Workspace'}</p>
        <h1 className="text-3xl sm:text-4xl">Set up the assessments</h1>
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
              {id === 'insights' ? 'Insights' : MODULE_LABELS[id]}
              {id !== 'insights' && !canEdit(profile, id) && id !== 'dashboard' && id !== 'audit' && (
                <span className="ml-1.5 text-xs font-normal text-ink-muted">(view)</span>
              )}
            </button>
          );
        })}
      </div>

      {section === 'dashboard' && <DashboardPanel />}
      {section === 'cycles' && <CyclesPanel canEdit={canEdit(profile, 'cycles')} />}
      {section === 'talents' && <OrgStructurePanel canEdit={canEdit(profile, 'talents')} />}
      {section === 'assignments' && (
        <AssignmentsPanel isAdmin={canEdit(profile, 'assignments')} canAdd={canEdit(profile, 'assignments')} />
      )}
      {section === 'users' && <UserControlPanel currentUser={profile} canEdit={canEdit(profile, 'users')} />}
      {section === 'audit' && <AuditTrailPanel />}
      {section === 'insights' && <InsightsPanel />}
    </div>
  );
}
