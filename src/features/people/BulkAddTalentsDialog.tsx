import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { Notice } from '@/components/Notice';
import type { PersonEntry } from '@/features/people/peopleQueries';
import { addExistingTalents, type BulkTalentResult } from '@/features/talents/talentFunctions';

type BulkAddTalentsDialogProps = {
  people: PersonEntry[];
  selected: PersonEntry[];
  onClose: () => void;
  onFinished: () => void;
};

type ManagerChoices = Record<string, string>;

function ResultStep({ result, onDone }: { result: BulkTalentResult; onDone: () => void }) {
  const managerNeeded = result.added.filter((person) => person.manager_needed);
  const emailProblems = result.added.filter((person) => !person.email_sent);
  const cycleProblems = result.added.filter((person) => person.failed_cycles.length > 0);

  return (
    <Modal title="Talents added" description="Here is what happened for each person." onClose={onDone}>
      <div className="space-y-6">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <SummaryTile label="Added" value={result.added.length} />
          <SummaryTile label="Manager needed" value={managerNeeded.length} />
          <SummaryTile label="Skipped" value={result.skipped.length} />
          <SummaryTile label="Failed" value={result.failed.length} />
        </dl>

        {result.added.length > 0 && (
          <PersonList
            title="Added"
            items={result.added.map((person) => ({
              key: person.profile_id,
              name: person.full_name,
              note: person.self_cycles.length > 0
                ? `Self assessment in ${person.self_cycles.join(', ')}`
                : 'No open or draft cycle, so no Self assessment yet',
            }))}
          />
        )}

        {managerNeeded.length > 0 && (
          <PersonList
            title="Manager needed"
            items={managerNeeded.map((person) => ({
              key: person.profile_id,
              name: person.full_name,
              note: 'Choose an immediate manager from their record.',
            }))}
          />
        )}

        {result.skipped.length > 0 && (
          <PersonList
            title="Skipped: already talents"
            items={result.skipped.map((person) => ({ key: person.profile_id, name: person.full_name, note: null }))}
          />
        )}

        {result.failed.length > 0 && (
          <PersonList
            title="Failed"
            items={result.failed.map((person) => ({ key: person.profile_id, name: person.full_name, note: person.message }))}
          />
        )}

        {emailProblems.length > 0 && (
          <Notice tone="info">
            The notice email could not be sent to {emailProblems.map((person) => person.full_name).join(', ')}. Let them know directly.
          </Notice>
        )}
        {cycleProblems.length > 0 && (
          <Notice tone="info">
            Manager invitations could not be sent for some cycles. Use Resend invite on the talent to try again.
          </Notice>
        )}

        <button type="button" onClick={onDone} className="btn-primary w-full">
          Done
        </button>
      </div>
    </Modal>
  );
}

function SummaryTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-line bg-canvas p-4">
      <dt className="text-xs font-semibold text-ink-muted">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold">{value}</dd>
    </div>
  );
}

function PersonList({
  title,
  items,
}: {
  title: string;
  items: { key: string; name: string; note: string | null }[];
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold">{title}</p>
      <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
        {items.map((item) => (
          <li key={item.key} className="px-4 py-3">
            <p className="text-sm font-semibold">{item.name}</p>
            {item.note && <p className="text-sm text-ink-muted">{item.note}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function BulkAddTalentsDialog({ people, selected, onClose, onFinished }: BulkAddTalentsDialogProps) {
  const [managers, setManagers] = useState<ManagerChoices>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BulkTalentResult | null>(null);

  if (result) return <ResultStep result={result} onDone={onFinished} />;

  const withoutManager = selected.filter((person) => !managers[person.id]).length;

  function setManager(personId: string, managerId: string) {
    setManagers((current) => ({ ...current, [personId]: managerId }));
  }

  function applyToAll(managerId: string) {
    setManagers(
      Object.fromEntries(
        selected.map((person) => [person.id, person.id === managerId ? '' : managerId]),
      ),
    );
  }

  async function handleConfirm() {
    setSaving(true);
    setError(null);
    const response = await addExistingTalents(
      selected.map((person) => {
        const managerId = managers[person.id] || null;
        return { profile_id: person.id, manager_ids: managerId ? [managerId] : [], primary_manager_id: managerId };
      }),
    );
    setSaving(false);

    if (!response.ok) {
      setError(response.message);
      return;
    }
    setResult(response.data);
  }

  return (
    <Modal
      title={`Add ${selected.length} as talents`}
      description="Each person keeps their account and role. Choose who each one reports to."
      onClose={onClose}
    >
      <div className="space-y-6">
        <Notice tone="info">
          Each person gets a talent record, a Self assessment in every open and draft cycle, and an email saying they were
          added as a talent. No password is created.
        </Notice>

        <div className="space-y-2">
          <label htmlFor="bulk-manager-all" className="text-sm font-semibold">
            Set the same manager for everyone
          </label>
          <select
            id="bulk-manager-all"
            className="field-input"
            value=""
            onChange={(event) => applyToAll(event.target.value)}
          >
            <option value="">Choose a manager</option>
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.full_name} ({person.email})
              </option>
            ))}
          </select>
        </div>

        <ul className="max-h-96 divide-y divide-line overflow-y-auto rounded-2xl border border-line bg-surface">
          {selected.map((person) => {
            const managerChoice = managers[person.id] ?? '';
            return (
              <li key={person.id} className="grid gap-3 px-4 py-4 sm:grid-cols-2 sm:items-center">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{person.full_name}</p>
                  <p className="truncate text-sm text-ink-muted">{person.email}</p>
                </div>
                <label className="sr-only" htmlFor={`manager-${person.id}`}>
                  Immediate manager for {person.full_name}
                </label>
                <select
                  id={`manager-${person.id}`}
                  className="field-input"
                  value={managerChoice}
                  onChange={(event) => setManager(person.id, event.target.value)}
                >
                  <option value="">No manager yet (flag as Manager needed)</option>
                  {people
                    .filter((candidate) => candidate.id !== person.id)
                    .map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>
                        {candidate.full_name}
                      </option>
                    ))}
                </select>
              </li>
            );
          })}
        </ul>

        <p className="text-sm text-ink-muted">
          {withoutManager === 0
            ? 'Everyone has a manager.'
            : `${withoutManager} ${withoutManager === 1 ? 'person has' : 'people have'} no manager yet and will be flagged Manager needed.`}
        </p>

        {error && <Notice>{error}</Notice>}

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} className="btn-secondary" disabled={saving}>
            Cancel
          </button>
          <button type="button" onClick={() => void handleConfirm()} className="btn-primary" disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {saving ? 'Adding...' : `Add ${selected.length} as talents`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
