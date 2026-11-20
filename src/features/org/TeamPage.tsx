import { useState } from 'react';
import { ChevronDown, ChevronRight, UserPlus, Users } from 'lucide-react';
import { Badge } from '@/components/Badge';
import { Notice } from '@/components/Notice';
import { ExternalRaters } from '@/features/org/ExternalRaters';
import { PeerManager } from '@/features/org/PeerManager';
import { QuickAddDialog } from '@/features/org/QuickAddDialog';
import { loadOrg } from '@/features/org/orgData';
import { SharedReports } from '@/features/reports/SharedReports';
import type { Profile } from '@/lib/types';
import { useAsyncData } from '@/lib/useAsyncData';

/** For anyone with direct reports: approve and add peers for the team, and open reports shared with them. */
export function TeamPage({ profile }: { profile: Profile }) {
  const { state, reload } = useAsyncData(loadOrg);
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const org = state.status === 'ready' ? state.data : null;
  const team = org ? (org.reportsOf.get(profile.id) ?? []).filter((p) => p.is_active) : [];
  const waiting = org ? org.peers.filter((l) => l.status === 'suggested' && team.some((t) => t.id === l.employee_id)) : [];

  return (
    <div className="space-y-10">
      <div className="space-y-2">
        <p className="eyebrow">Your team</p>
        <h1 className="text-3xl sm:text-4xl">My team</h1>
        <p className="max-w-2xl text-base leading-relaxed text-ink-muted">
          Choose who gives your direct reports Peer and External feedback, approve their suggestions, add new team members,
          and open reports an administrator has shared with you.
        </p>
      </div>

      <section className="space-y-4" aria-labelledby="team-heading">
        <div className="flex flex-wrap items-center gap-3">
          <h2 id="team-heading" className="flex items-center gap-2 text-xl">
            <Users className="h-5 w-5 text-primary" aria-hidden="true" />
            Direct reports
          </h2>
          {waiting.length > 0 && <Badge tone="warning">{waiting.length} peer suggestion{waiting.length === 1 ? '' : 's'} waiting</Badge>}
          {org && (
            <button type="button" className="btn-secondary ml-auto px-3 py-2" onClick={() => setAdding(true)}>
              <UserPlus className="h-4 w-4" aria-hidden="true" />
              Add a direct report
            </button>
          )}
        </div>
        {notice && <Notice tone="info">{notice}</Notice>}
        {adding && org && (
          <QuickAddDialog
            org={org}
            fixedManagerId={profile.id}
            onClose={() => setAdding(false)}
            onDone={(message) => {
              setAdding(false);
              setNotice(message);
              reload();
            }}
          />
        )}

        {state.status === 'loading' && <p className="text-sm text-ink-muted">Loading your team...</p>}
        {state.status === 'error' && (
          <Notice>
            We could not load your team.{' '}
            <button type="button" onClick={reload} className="font-semibold underline underline-offset-4">
              Try again
            </button>
          </Notice>
        )}
        {org && team.length === 0 && <p className="text-sm text-ink-muted">Nobody reports to you in the org structure yet.</p>}

        <ul className="space-y-3">
          {org &&
            team.map((person) => {
              const pending = waiting.filter((l) => l.employee_id === person.id).length;
              const approved = org.peers.filter((l) => l.employee_id === person.id && l.status === 'approved').length;
              const expanded = open === person.id;
              return (
                <li key={person.id} className="rounded-card border border-line bg-surface">
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 p-4 text-left"
                    aria-expanded={expanded}
                    onClick={() => setOpen(expanded ? null : person.id)}
                  >
                    {expanded ? <ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" /> : <ChevronRight className="h-4 w-4 shrink-0" aria-hidden="true" />}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{person.full_name}</span>
                      <span className="block truncate text-xs text-ink-muted">{[person.position, person.department].filter(Boolean).join(' · ') || person.email}</span>
                    </span>
                    <span className="flex shrink-0 gap-2">
                      <Badge tone="neutral">{approved} peer{approved === 1 ? '' : 's'}</Badge>
                      {pending > 0 && <Badge tone="warning">{pending} to review</Badge>}
                    </span>
                  </button>
                  {expanded && (
                    <div className="space-y-6 border-t border-line p-4">
                      <PeerManager org={org} employee={person} canManage onChanged={reload} />
                      <ExternalRaters org={org} employee={person} canManage onChanged={reload} />
                    </div>
                  )}
                </li>
              );
            })}
        </ul>
      </section>

      <SharedReports />
    </div>
  );
}
