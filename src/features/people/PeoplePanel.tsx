import { useMemo, useState } from 'react';
import { UserRound } from 'lucide-react';
import { Badge } from '@/components/Badge';
import { Notice } from '@/components/Notice';
import { BulkAddTalentsDialog } from '@/features/people/BulkAddTalentsDialog';
import { PersonNotificationsDialog } from '@/features/notifications/PersonNotificationsDialog';
import { loadPeople, type PersonEntry } from '@/features/people/peopleQueries';
import { useAsyncData } from '@/lib/useAsyncData';

type Filter = 'all' | 'assessors' | 'talents' | 'managers';

const FILTERS: { id: Filter; label: string; matches: (person: PersonEntry) => boolean }[] = [
  { id: 'all', label: 'All', matches: () => true },
  { id: 'assessors', label: 'Assessors', matches: (person) => person.isAssessor },
  { id: 'talents', label: 'Talents', matches: (person) => person.talentId !== null },
  { id: 'managers', label: 'Managers', matches: (person) => person.managesTalents },
];

function RelationshipBadges({ person }: { person: PersonEntry }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {person.role === 'admin' && <Badge tone="neutral">Admin</Badge>}
      {person.isAssessor && <Badge tone="neutral">Assessor</Badge>}
      {person.talentId && <Badge tone="neutral">Talent</Badge>}
      {person.managesTalents && <Badge tone="neutral">Manager</Badge>}
      {person.managerNeeded && <Badge tone="warning">Manager needed</Badge>}
    </div>
  );
}

export function PeoplePanel({
  canEdit = true,
  canManageNotifications = false,
}: {
  canEdit?: boolean;
  /** Per-person notification settings are admin-only. */
  canManageNotifications?: boolean;
}) {
  const { state, reload } = useAsyncData(loadPeople);
  const [filter, setFilter] = useState<Filter>('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [notificationsPerson, setNotificationsPerson] = useState<PersonEntry | null>(null);

  const people = useMemo(() => (state.status === 'ready' ? state.data : []), [state]);
  const activeFilter = FILTERS.find((item) => item.id === filter) ?? FILTERS[0];
  const visible = useMemo(() => people.filter(activeFilter.matches), [people, activeFilter]);
  const selectable = canEdit ? visible.filter((person) => person.talentId === null) : [];
  const selectedPeople = people.filter((person) => selectedIds.has(person.id));

  function toggle(person: PersonEntry) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(person.id)) next.delete(person.id);
      else next.add(person.id);
      return next;
    });
  }

  function selectAllShown() {
    setSelectedIds((current) => new Set([...current, ...selectable.map((person) => person.id)]));
  }

  return (
    <section className="space-y-6" aria-labelledby="people-heading">
      <div className="space-y-1">
        <h2 id="people-heading" className="text-2xl">
          People
        </h2>
        <p className="text-sm leading-relaxed text-ink-muted">
          Everyone with an account, and what they do in the assessment.{canEdit ? ' Select people to make them talents.' : ''}
        </p>
      </div>

      <div role="tablist" aria-label="Filter people" className="flex gap-1 rounded-2xl bg-muted p-1">
        {FILTERS.map((item) => {
          const selected = filter === item.id;
          const count = state.status === 'ready' ? people.filter(item.matches).length : null;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setFilter(item.id)}
              className={`flex-1 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors duration-200 sm:px-4 ${
                selected ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted hover:text-ink'
              }`}
            >
              {item.label}
              {count !== null && <span className="ml-1.5 text-ink-muted">{count}</span>}
            </button>
          );
        })}
      </div>

      {state.status === 'loading' && <p className="text-sm text-ink-muted">Loading people...</p>}

      {state.status === 'error' && (
        <Notice>
          We could not load people.{' '}
          <button type="button" onClick={reload} className="font-semibold underline underline-offset-4">
            Try again
          </button>
        </Notice>
      )}

      {state.status === 'ready' && selectedIds.size > 0 && (
        <div className="sticky top-4 z-10 flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4 shadow-md sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm font-semibold">{selectedIds.size} selected</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setSelectedIds(new Set())} className="btn-secondary">
              Clear
            </button>
            <button type="button" onClick={() => setBulkOpen(true)} className="btn-primary">
              Add as talents
            </button>
          </div>
        </div>
      )}

      {state.status === 'ready' && visible.length === 0 && (
        <div className="rounded-card border border-dashed border-line bg-surface p-8 text-center">
          <p className="font-semibold">No one here yet</p>
          <p className="mt-1 text-sm text-ink-muted">Nobody matches this filter.</p>
        </div>
      )}

      {state.status === 'ready' && visible.length > 0 && (
        <>
          {selectable.length > 0 && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={selectAllShown}
                className="text-sm font-semibold text-primary underline underline-offset-4"
              >
                Select all shown ({selectable.length})
              </button>
            </div>
          )}
          <ul className="space-y-3">
            {visible.map((person) => {
              const isTalent = person.talentId !== null;
              const checked = selectedIds.has(person.id);
              return (
                <li key={person.id}>
                  <label
                    className={`flex items-start gap-4 rounded-card border border-line bg-surface p-5 transition-shadow duration-200 hover:shadow-md ${
                      isTalent || !canEdit ? 'opacity-80' : 'cursor-pointer'
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 shrink-0 accent-primary"
                      checked={checked}
                      disabled={isTalent || !canEdit}
                      onChange={() => toggle(person)}
                      aria-label={`Select ${person.full_name}`}
                    />
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-muted text-primary">
                      <UserRound className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1 space-y-2">
                      <span className="block truncate font-semibold">{person.full_name}</span>
                      <span className="block truncate text-sm text-ink-muted">{person.email}</span>
                      <RelationshipBadges person={person} />
                      </span>
{canManageNotifications && (
                                            <button
                        type="button"
                        className="shrink-0 self-center text-sm font-semibold text-primary underline-offset-4 hover:underline"
                        onClick={(event) => {
                          event.preventDefault();
                          setNotificationsPerson(person);
                        }}
                      >
                        Notification settings
                      </button>
                      )}
                  </label>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {bulkOpen && state.status === 'ready' && (
        <BulkAddTalentsDialog
          people={people}
          selected={selectedPeople}
          onClose={() => setBulkOpen(false)}
          onFinished={() => {
            setBulkOpen(false);
            setSelectedIds(new Set());
            reload();
          }}
        />
      )}

      {notificationsPerson && (
        <PersonNotificationsDialog
          person={{
            id: notificationsPerson.id,
            full_name: notificationsPerson.full_name,
            role: notificationsPerson.role,
            manages_talents: notificationsPerson.managesTalents,
            is_talent: notificationsPerson.talentId !== null,
            email: notificationsPerson.email,
          }}
          onFinished={() => {}}
          onClose={() => setNotificationsPerson(null)}
        />
      )}
    </section>
  );
}
