import { useState, type FormEvent } from 'react';
import { Loader2 } from 'lucide-react';
import { FormField } from '@/components/FormField';
import { Modal } from '@/components/Modal';
import { Notice } from '@/components/Notice';
import { PersonPicker } from '@/features/people/PersonPicker';
import { ManagerSelector } from '@/features/talents/ManagerSelector';
import { EMPTY_MANAGER_CHOICE, toggleManager, type ManagerChoice } from '@/features/talents/managerChoice';
import { type CreateTalentBody, type CreateTalentResult, createTalent } from '@/features/talents/talentFunctions';
import type { ProfileRef, TalentRecord } from '@/lib/records';
import { isValidEmail } from '@/lib/validation';

type CreateTalentDialogProps = {
  people: ProfileRef[];
  talents: TalentRecord[];
  onClose: () => void;
  onCreated: () => void;
  onShowTalent: (talent: TalentRecord) => void;
};

const NEW_PERSON = 'new';

type CreateForm = {
  talentChoice: string;
  fullName: string;
  email: string;
  department: string;
  position: string;
  managers: ManagerChoice;
  addNewManager: boolean;
  newManagerName: string;
  newManagerEmail: string;
};

const EMPTY_FORM: CreateForm = {
  talentChoice: '',
  fullName: '',
  email: '',
  department: '',
  position: '',
  managers: EMPTY_MANAGER_CHOICE,
  addNewManager: false,
  newManagerName: '',
  newManagerEmail: '',
};

function findPerson(people: ProfileRef[], id: string): ProfileRef | null {
  return people.find((person) => person.id === id) ?? null;
}

function findPersonByEmail(people: ProfileRef[], email: string): ProfileRef | null {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;
  return people.find((person) => person.email.toLowerCase() === normalized) ?? null;
}

function findProblem(form: CreateForm, people: ProfileRef[], talentIds: Set<string>): string | null {
  const talentPerson = form.talentChoice && form.talentChoice !== NEW_PERSON ? findPerson(people, form.talentChoice) : null;

  if (!form.talentChoice) return 'Choose the talent.';
  if (form.talentChoice !== NEW_PERSON) {
    if (!talentPerson) return 'Choose the talent.';
    if (talentIds.has(talentPerson.id)) return 'This person is already a talent.';
  } else {
    if (!form.fullName.trim()) return 'Enter the talent’s name.';
    if (!isValidEmail(form.email)) return 'Enter a valid email address for the talent.';
    if (findPersonByEmail(people, form.email)) {
      return 'This person already has an account. Use the existing person instead.';
    }
  }

  if (form.managers.ids.length === 0 && !form.addNewManager) return 'Choose at least one immediate manager for this talent.';
  if (talentPerson && form.managers.ids.includes(talentPerson.id)) {
    return 'A talent cannot be their own immediate manager. Choose someone else.';
  }
  if (form.addNewManager) {
    if (!form.newManagerName.trim()) return 'Enter the new manager’s name.';
    if (!isValidEmail(form.newManagerEmail)) return 'Enter a valid email address for the new manager.';
    if (form.newManagerEmail.trim().toLowerCase() === form.email.trim().toLowerCase()) {
      return 'The talent and their manager need different email addresses.';
    }
  }
  return null;
}

function buildBody(form: CreateForm, talentPersonId: string | null): CreateTalentBody {
  return {
    ...(talentPersonId
      ? { talent_profile_id: talentPersonId }
      : { full_name: form.fullName.trim(), email: form.email.trim() }),
    department: form.department.trim() || null,
    position: form.position.trim() || null,
    manager_ids: form.managers.ids,
    primary_manager_id: form.managers.primaryId,
    new_manager: form.addNewManager
      ? { full_name: form.newManagerName.trim(), email: form.newManagerEmail.trim() }
      : null,
  };
}

function AddedSummary({ result, onClose }: { result: CreateTalentResult; onClose: () => void }) {
  return (
    <Modal title="Talent added" description="Here is what changed for each person." onClose={onClose}>
      <div className="space-y-6">
        {result.existing_person && (
          <p className="text-sm leading-relaxed text-ink-muted">
            This person keeps their existing account, sign-in and role. No new account or password was created.
          </p>
        )}
        {result.existing_person && result.self_cycles.length > 0 && (
          <p className="text-sm leading-relaxed text-ink-muted">
            A Self assessment was added in: {result.self_cycles.join(', ')}.
          </p>
        )}
        {result.talent_email_sent === true && (
          <p className="text-sm leading-relaxed text-ink-muted">They were emailed that they were added as a talent.</p>
        )}
        {result.talent_email_sent === false && (
          <Notice>The notice email could not be sent. Let them know directly that they were added as a talent.</Notice>
        )}
        {result.failed_cycles.length > 0 && (
          <Notice>
            The invitation could not be sent for: {result.failed_cycles.join(', ')}. Use Resend invite on the talent to try again.
          </Notice>
        )}
        {result.accounts.length > 0 && (
          <>
            <p className="text-sm leading-relaxed text-ink-muted">
              Share these temporary passwords now. They will not be shown again. Each person must choose their own password
              the first time they sign in.
            </p>
            <ul className="space-y-3">
              {result.accounts.map((account) => (
                <li key={account.email} className="rounded-2xl border border-line bg-canvas p-4">
                  <p className="font-semibold">
                    {account.full_name}
                    <span className="ml-2 text-sm font-normal text-ink-muted">
                      {account.role === 'manager' ? 'Manager' : 'Talent'}
                    </span>
                  </p>
                  <p className="break-all text-sm text-ink-muted">{account.email}</p>
                  <p className="mt-3 select-all break-all font-mono text-base font-semibold">
                    {account.temporary_password}
                  </p>
                </li>
              ))}
            </ul>
          </>
        )}
        <button type="button" onClick={onClose} className="btn-primary w-full">
          Done
        </button>
      </div>
    </Modal>
  );
}

export function CreateTalentDialog({ people, talents, onClose, onCreated, onShowTalent }: CreateTalentDialogProps) {
  const [form, setForm] = useState<CreateForm>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<CreateTalentResult | null>(null);

  if (result) return <AddedSummary result={result} onClose={onClose} />;

  const talentIds = new Set(talents.map((talent) => talent.profile_id));
  const addsNewTalent = form.talentChoice === NEW_PERSON;
  const talentPerson = form.talentChoice && !addsNewTalent ? findPerson(people, form.talentChoice) : null;
  const talentRecord = talentPerson ? talents.find((talent) => talent.profile_id === talentPerson.id) ?? null : null;
  const existingTalentEmailMatch = addsNewTalent ? findPersonByEmail(people, form.email) : null;

  const existingNewManager = form.addNewManager ? findPersonByEmail(people, form.newManagerEmail) : null;
  const managerIsTalent = Boolean(talentPerson && form.managers.ids.includes(talentPerson.id));

  function update<K extends keyof CreateForm>(key: K, value: CreateForm[K]) {
    setForm((previous) => ({ ...previous, [key]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const problem = findProblem(form, people, talentIds);
    if (problem) {
      setError(problem);
      return;
    }

    setSaving(true);
    setError(null);
    const response = await createTalent(buildBody(form, talentPerson?.id ?? null));
    setSaving(false);

    if (!response.ok) {
      setError(response.message);
      return;
    }
    setResult(response.data);
    onCreated();
  }

  return (
    <Modal title="Add a talent" description="Choose who is assessed and who they report to." onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-6" noValidate>
        <FormField id="talent-person" label="Talent" hint="Anyone in the system can be a talent, including assessors and managers.">
          <PersonPicker
            id="talent-person"
            people={people}
            selectedId={talentPerson?.id ?? null}
            onSelect={(person) => update('talentChoice', person.id)}
            onAddNew={() => update('talentChoice', NEW_PERSON)}
          />
        </FormField>

        {talentPerson && talentRecord && (
          <Notice tone="info">
            <span className="block">{talentPerson.full_name} is already a talent.</span>
            <button
              type="button"
              onClick={() => onShowTalent(talentRecord)}
              className="mt-2 font-semibold underline underline-offset-4"
            >
              View their talent record
            </button>
          </Notice>
        )}

        {talentPerson && !talentRecord && (
          <Notice tone="info">
            {talentPerson.full_name} already has an account. They keep their current sign-in and role, and get a Self
            assessment in open cycles.
          </Notice>
        )}

        {addsNewTalent && (
          <div className="space-y-5 rounded-2xl bg-canvas p-5">
            <div className="grid gap-5 sm:grid-cols-2">
              <FormField id="talent-name" label="Full name">
                <input
                  id="talent-name"
                  className="field-input"
                  value={form.fullName}
                  onChange={(event) => update('fullName', event.target.value)}
                  maxLength={200}
                  autoFocus
                />
              </FormField>
              <FormField id="talent-email" label="Email">
                <input
                  id="talent-email"
                  type="email"
                  autoComplete="off"
                  className="field-input"
                  value={form.email}
                  onChange={(event) => update('email', event.target.value)}
                />
              </FormField>
            </div>
            {existingTalentEmailMatch && (
              <Notice tone="info">
                <span className="block">
                  This person already has an account ({existingTalentEmailMatch.full_name}).
                </span>
                <button
                  type="button"
                  onClick={() => update('talentChoice', existingTalentEmailMatch.id)}
                  className="mt-2 font-semibold underline underline-offset-4"
                >
                  Use existing person
                </button>
              </Notice>
            )}
            <button
              type="button"
              onClick={() => update('talentChoice', '')}
              className="text-sm font-semibold text-primary underline underline-offset-4"
            >
              Choose someone from the list instead
            </button>
          </div>
        )}

        <div className="grid gap-5 sm:grid-cols-2">
          <FormField id="talent-department" label="Department">
            <input
              id="talent-department"
              className="field-input"
              value={form.department}
              onChange={(event) => update('department', event.target.value)}
              maxLength={200}
            />
          </FormField>
          <FormField id="talent-position" label="Position">
            <input
              id="talent-position"
              className="field-input"
              value={form.position}
              onChange={(event) => update('position', event.target.value)}
              maxLength={200}
            />
          </FormField>
        </div>

        <ManagerSelector
          id="talent-managers"
          people={people}
          excludeId={talentPerson?.id ?? null}
          value={form.managers}
          onChange={(value) => update('managers', value)}
        />

        {managerIsTalent && <Notice>A talent cannot be their own immediate manager. Choose someone else.</Notice>}

        <label className="flex cursor-pointer items-center gap-3 text-sm font-semibold">
          <input
            type="checkbox"
            checked={form.addNewManager}
            onChange={(event) => update('addNewManager', event.target.checked)}
            className="h-4 w-4 accent-primary"
          />
          Add a manager who does not have an account yet
        </label>

        {form.addNewManager && existingNewManager && (
          <Notice tone="info">
            <span className="block">{existingNewManager.full_name} already has an account.</span>
            <button
              type="button"
              onClick={() => {
                update('managers', toggleManager(form.managers, existingNewManager.id));
                update('addNewManager', false);
              }}
              className="mt-2 font-semibold underline underline-offset-4"
            >
              Use existing person
            </button>
          </Notice>
        )}

        {form.addNewManager && (
          <div className="grid gap-5 rounded-2xl bg-canvas p-5 sm:grid-cols-2">
            <FormField id="new-manager-name" label="New manager’s name">
              <input
                id="new-manager-name"
                className="field-input"
                value={form.newManagerName}
                onChange={(event) => update('newManagerName', event.target.value)}
                maxLength={200}
              />
            </FormField>
            <FormField id="new-manager-email" label="New manager’s email">
              <input
                id="new-manager-email"
                type="email"
                autoComplete="off"
                className="field-input"
                value={form.newManagerEmail}
                onChange={(event) => update('newManagerEmail', event.target.value)}
              />
            </FormField>
          </div>
        )}

        {error && <Notice>{error}</Notice>}

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {saving ? 'Adding...' : 'Add talent'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
