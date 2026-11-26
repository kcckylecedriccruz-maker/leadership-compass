import { useState, type FormEvent } from 'react';
import { Loader2 } from 'lucide-react';
import { FormField } from '@/components/FormField';
import { Modal } from '@/components/Modal';
import { Notice } from '@/components/Notice';
import { inviteAssessor, type InviteAssessorResult } from '@/features/assignments/assignmentFunctions';
import { EmployeePicker, type PickerValue } from '@/features/assignments/EmployeePicker';
import { CLASSIFICATION_DESCRIPTIONS, CLASSIFICATION_LABELS } from '@/lib/format';
import { CLASSIFICATIONS, type Classification, type CycleRecord, type ProfileRef, type TalentRecord } from '@/lib/records';
import { isValidEmail } from '@/lib/validation';

type AddAssessorDialogProps = {
  cycle: CycleRecord;
  talent: TalentRecord;
  /** Kept for callers; the employee list now loads in the picker. */
  people?: ProfileRef[];
  /** People already evaluating this person in this cycle (hidden from the list). */
  assignedIds?: Set<string>;
  /** assessor id -> the type they already have, to explain why they are not listed. */
  assignedKinds?: Map<string, Classification>;
  onAdded: () => void;
  onClose: () => void;
};

// Everyone except Self is chosen from the list (or by email for external raters and someone new).
const PERSON_TYPES: readonly Classification[] = ['immediate_manager', 'skip_level_manager', 'direct_report', 'skip_level_report', 'peer', 'external'];

export function AddAssessorDialog({ cycle, talent, assignedIds = new Set(), assignedKinds = new Map(), onAdded, onClose }: AddAssessorDialogProps) {
  const [classification, setClassification] = useState<Classification | null>(null);
  const [picked, setPicked] = useState<PickerValue>(null);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [organisation, setOrganisation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [unsentResult, setUnsentResult] = useState<InviteAssessorResult | null>(null);

  const needsEmail = classification !== null && PERSON_TYPES.includes(classification);
  const isExternal = classification === 'external';
  // Employees are picked from the list; only external raters and "Someone new" are typed in.
  const typesDetails = needsEmail && (isExternal || picked?.kind === 'new');

  function describe(option: Classification): string {
    if (option === 'immediate_manager') {
      return `Rates ${talent.profile.full_name} as their manager in this cycle only. Org structure is not changed.`;
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
    if (needsEmail && !isExternal && !picked) {
      setError('Choose an employee from the list, or select Someone new.');
      return;
    }
    if (typesDetails && !isValidEmail(email)) {
      setError('Enter a valid email address for this person.');
      return;
    }
    if (typesDetails && !name.trim()) {
      setError('Enter their full name.');
      return;
    }

    setSaving(true);
    setError(null);
    const result = await inviteAssessor({
      cycle_id: cycle.id,
      talent_id: talent.id,
      classification,
      assessor_email: !needsEmail ? null : picked?.kind === 'existing' && !isExternal ? picked.employee.email : email.trim(),
      assessor_name: typesDetails && name.trim() ? name.trim() : null,
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
              const checked = classification === option;
              return (
                <label
                  key={option}
                  className={`flex cursor-pointer items-start gap-4 rounded-2xl border p-4 transition-colors duration-200 ${
                    checked ? 'border-primary bg-muted' : 'border-line bg-surface hover:bg-muted'
                  }`}
                >
                  <input
                    type="radio"
                    name="classification"
                    value={option}
                    checked={checked}
                    onChange={() => {
                      setClassification(option);
                      setError(null);
                    }}
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

          {needsEmail && !isExternal && classification && (
            <div className="space-y-2">
              <p className="text-sm font-semibold">Employee</p>
              <EmployeePicker
                subjectProfileId={talent.profile_id}
                excludeIds={assignedIds}
                excludeKinds={assignedKinds}
                kind={classification}
                value={picked}
                onChange={(value) => {
                  setPicked(value);
                  setError(null);
                }}
              />
            </div>
          )}

          {typesDetails && (
            <div className="grid gap-5 sm:grid-cols-2">
              <FormField
                id="assessor-email"
                label="Email"
                hint={
                  isExternal
                    ? 'They never get an account; they answer by secure email link.'
                    : 'Their work email. They answer by secure link until they activate an account.'
                }
              >
                <input
                  id="assessor-email"
                  type="email"
                  autoComplete="off"
                  className="field-input"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </FormField>
              <FormField id="assessor-name" label="Full name" hint={isExternal ? 'Needed for someone not added before.' : 'As it should appear in the app.'}>
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
