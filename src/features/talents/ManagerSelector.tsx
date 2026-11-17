import { Star } from 'lucide-react';
import type { ProfileRef } from '@/lib/records';
import { candidateManagers, setPrimaryManager, toggleManager, type ManagerChoice } from '@/features/talents/managerChoice';

type ManagerSelectorProps = {
  id: string;
  people: ProfileRef[];
  excludeId: string | null;
  value: ManagerChoice;
  onChange: (value: ManagerChoice) => void;
};

export function ManagerSelector({ id, people, excludeId, value, onChange }: ManagerSelectorProps) {
  const candidates = candidateManagers(people, excludeId);

  return (
    <fieldset className="space-y-3">
      <legend className="mb-1 text-sm font-semibold">Immediate managers</legend>
      <p className="text-sm leading-relaxed text-ink-muted">
        Choose at least one. Each manager is identifiable to the talent, and the manager score is the average of all of
        them. Mark one as primary.
      </p>
      <ul id={id} className="max-h-64 space-y-2 overflow-y-auto rounded-2xl border border-line bg-canvas p-2">
        {candidates.map((person) => {
          const checked = value.ids.includes(person.id);
          const primary = value.primaryId === person.id;
          return (
            <li
              key={person.id}
              className={`flex items-center gap-3 rounded-xl px-3 py-2 transition-colors duration-200 ${
                checked ? 'bg-muted' : 'hover:bg-muted'
              }`}
            >
              <input
                id={`${id}-${person.id}`}
                type="checkbox"
                checked={checked}
                onChange={() => onChange(toggleManager(value, person.id))}
                className="h-4 w-4 accent-primary"
              />
              <label htmlFor={`${id}-${person.id}`} className="min-w-0 flex-1 cursor-pointer">
                <span className="block truncate text-sm font-semibold">{person.full_name}</span>
                <span className="block truncate text-xs text-ink-muted">{person.email}</span>
              </label>
              {checked && (
                <button
                  type="button"
                  onClick={() => onChange(setPrimaryManager(value, person.id))}
                  aria-pressed={primary}
                  className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold transition-colors duration-200 ${
                    primary ? 'bg-primary text-on-primary' : 'border border-line bg-surface text-ink hover:bg-muted'
                  }`}
                >
                  <Star className="h-3 w-3" aria-hidden="true" />
                  {primary ? 'Primary' : 'Make primary'}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <p className="text-sm text-ink-muted">
        {value.ids.length} selected{value.ids.length === 0 ? '' : value.primaryId ? ' · one primary' : ''}
      </p>
    </fieldset>
  );
}
