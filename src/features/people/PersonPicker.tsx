import { Check, Search } from 'lucide-react';
import { useState } from 'react';
import type { ProfileRef } from '@/lib/records';

type PersonPickerProps = {
  id: string;
  people: ProfileRef[];
  selectedId: string | null;
  onSelect: (person: ProfileRef) => void;
  onAddNew?: () => void;
};

const RESULT_LIMIT = 6;

export function PersonPicker({ id, people, selectedId, onSelect, onAddNew }: PersonPickerProps) {
  const [query, setQuery] = useState('');
  const term = query.trim().toLowerCase();
  const matches = term
    ? people.filter(
        (person) => person.full_name.toLowerCase().includes(term) || person.email.toLowerCase().includes(term),
      )
    : people;

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
        <input
          id={id}
          type="search"
          autoComplete="off"
          placeholder="Search by name or email"
          className="field-input pl-10"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      {matches.length === 0 ? (
        <p className="text-sm text-ink-muted">No one matches “{query.trim()}”.</p>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface" role="listbox" aria-label="People">
          {matches.slice(0, RESULT_LIMIT).map((person) => {
            const selected = person.id === selectedId;
            return (
              <li key={person.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => onSelect(person)}
                  className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors duration-200 hover:bg-muted ${
                    selected ? 'bg-muted' : ''
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">{person.full_name}</span>
                    <span className="block truncate text-sm text-ink-muted">{person.email}</span>
                  </span>
                  {selected && <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {matches.length > RESULT_LIMIT && (
        <p className="text-xs text-ink-muted">Showing {RESULT_LIMIT} of {matches.length}. Keep typing to narrow the list.</p>
      )}

      {onAddNew && (
        <button type="button" onClick={onAddNew} className="btn-secondary w-full">
          Add new person
        </button>
      )}
    </div>
  );
}
