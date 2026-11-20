import { useState, type FormEvent } from 'react';
import { Loader2 } from 'lucide-react';
import { FormField } from '@/components/FormField';
import { Modal } from '@/components/Modal';
import { Notice } from '@/components/Notice';
import { inviteAssessor, type InviteAssessorResult } from '@/features/assignments/assignmentFunctions';
import { CLASSIFICATION_DESCRIPTIONS, CLASSIFICATION_LABELS } from '@/lib/format';
import { CLASSIFICATIONS, type Classification, type CycleRecord, type ProfileRef, type TalentRecord } from '@/lib/records';
import { isValidEmail } from '@/lib/validation';

type AddAssessorDialogProps = {
  cycle: CycleRecord;
  talent: TalentRecord;
  people: ProfileRef[];
  onAdded: () => void;
  onClose: () => void;
};

// Everyone except Self and Immediate manager is chosen by email.
const PERSON_TYPES: readonly Classification[] = ['skip_level_manager', 'direct_report', 'skip_level_report', 'peer', 'external'];

export function AddAssessorDialog({ cycle, talent, people, onAdded, onClose }: AddAssessorDialogProps) {
  const [classification, setClassification] = useState<Classification | null>(null);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [organisation, setOrganisation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [unsentResult, setUnsentResult] = useState<InviteAssessorResult | null>(null);

  const needsEmail = classification !== null && PERSON_TYPES.includes(classification);
  const isExternal = classification === 'external';

  function describe(option: Classification): string {
    if (option === 'immediate_manager') {
      return 'Added automatically from the talent’s managers in every open and draft cycle.';
    }
    if (option === 'self') return `${talent.profile.full_name} completes their own assessment.`;
    return CLASSIFICATION_DESCRIPTIONS[option];
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!classification) {
      setError('Choose the type of assessor first.');
      return;
    }
    if (needsEmail && !isValidEmail(email)) {
      setError('Enter a valid email address for this person.');
      return;
    }

    setSaving(true);
    setError(null);
    const result = await inviteAssessor({
      cycle_id: cycle.id,
      talent_id: talent.id,
      classification,
      assessor_email: needsEmail ? email.trim() : null,
      assessor_name: needsEmail && name.trim() ? name.trim() : null,
      organisation: isExternal && organisation.trim() ? organisation.trim() : null,
    });
    setSaving(false);

    if (!result.ok) {
      setError(result.message);
      return;
    }
    onAdded();
    if (result.data.email_sent || result.data.waiting_for_open) {
      onClose();
      return;
    }
    setUnsentResult(result.data);
  }

  return (
    <Modal
      title="Add an assessor"
      description={`For ${talent.profile.full_name} in ${cycle.name}`}
      onClose={onClose}
    >
      {unsentResult ? (
        <div className="space-y-6">
          <Notice tone="info">
            The assessment was added, but the invite email could not be sent just now. Use Resend invite on the
            assessor's row to send it again.
          </Notice>
          <button type="button" onClick={onClose} className="btn-primary w-full">
            Done
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-6" noValidate>
          <fieldset className="space-y-3">
            <legend className="mb-3 text-sm font-semibold">Who is this assessor?</legend>
            {CLASSIFICATIONS.map((option) => {
              const disabled = option === 'immediate_manager';
              const checked = classification === option;
              return (
                <label
                  key={option}
                  className={`flex items-start gap-4 rounded-2xl border p-4 transition-colors duration-200 ${
                    checked ? 'border-primary bg-muted' : 'border-line bg-surface hover:bg-muted'
                  } ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
                >
                  <input
                    type="radio"
                    name="classification"
                    value={option}
                    checked={checked}
                    disabled={disabled}
                    onChange={() => setClassification(option)}
                    className="mt-1 h-4 w-4 accent-primary"
                  />
                  <span className="min-w-0 space-y-1">
                    <span className="block text-sm font-semibold">{CLASSIFICATION_LABELS[option]}</span>
                    <span className="block text-sm leading-relaxed text-ink-muted">{describe(option)}</span>
                  </span>
                </label>
              );
            })}
          </fieldset>

          {needsEmail && (
            <div className="grid gap-5 sm:grid-cols-2">
              <FormField
                id="assessor-email"
                label="Email"
                hint={
                  isExternal
                    ? 'They never get an account; they answer by secure email link.'
                    : 'Use the email of an existing person to link them.'
                }
              >
                <input
                  id="assessor-email"
                  type="email"
                  autoComplete="off"
                  list={isExternal ? undefined : 'known-people'}
                  className="field-input"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </FormField>
              <FormField id="assessor-name" label="Full name" hint={isExternal ? 'Needed for someone not added before.' : 'Needed only for someone new.'}>
                <input
                  id="assessor-name"
                  className="field-input"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={200}
                />
              </FormField>
              {isExternal && (
                <FormField id="assessor-org" label="Organisation (optional)" hint="Client, partner or contractor company.">
                  <input
                    id="assessor-org"
                    className="field-input"
                    value={organisation}
                    onChange={(event) => setOrganisation(event.target.value)}
                    maxLength={100}
                  />
                </FormField>
              )}
              <datalist id="known-people">
                {people.map((person) => (
                  <option key={person.id} value={person.email}>
                    {person.full_name}
                  </option>
                ))}
              </datalist>
            </div>
          )}

          {error && <Notice>{error}</Notice>}

          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button type="button" onClick={onClose} className="btn-secondary">
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {saving ? 'Adding...' : 'Add assessor'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
