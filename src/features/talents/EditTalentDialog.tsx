import { useState, type FormEvent } from 'react';
import { Loader2 } from 'lucide-react';
import { FormField } from '@/components/FormField';
import { Modal } from '@/components/Modal';
import { Notice } from '@/components/Notice';
import { databaseErrorMessage } from '@/lib/errors';
import { ManagerSelector } from '@/features/talents/ManagerSelector';
import { type ManagerChoice } from '@/features/talents/managerChoice';
import type { ProfileRef, TalentRecord } from '@/lib/records';
import { supabase } from '@/lib/supabase';

type EditTalentDialogProps = {
  talent: TalentRecord;
  people: ProfileRef[];
  onClose: () => void;
  onSaved: () => void;
};

function initialChoice(talent: TalentRecord): ManagerChoice {
  const primary = talent.managers.find((item) => item.is_primary);
  return {
    ids: talent.managers.map((item) => item.manager_profile_id),
    primaryId: primary?.manager_profile_id ?? talent.managers[0]?.manager_profile_id ?? null,
  };
}

function sameChoice(a: ManagerChoice, b: ManagerChoice): boolean {
  return a.primaryId === b.primaryId && a.ids.length === b.ids.length && a.ids.every((id) => b.ids.includes(id));
}

export function EditTalentDialog({ talent, people, onClose, onSaved }: EditTalentDialogProps) {
  const [fullName, setFullName] = useState(talent.profile.full_name);
  const [department, setDepartment] = useState(talent.department ?? '');
  const [position, setPosition] = useState(talent.position ?? '');
  const [managers, setManagers] = useState<ManagerChoice>(() => initialChoice(talent));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = fullName.trim();
    if (!trimmedName) {
      setError('Enter the talent’s name.');
      return;
    }
    if (managers.ids.length === 0 || !managers.primaryId) {
      setError('Choose at least one immediate manager and mark one as primary.');
      return;
    }
    if (managers.ids.includes(talent.profile_id)) {
      setError('A talent cannot be their own immediate manager. Choose someone else.');
      return;
    }

    setSaving(true);
    setError(null);
    const { error: talentError } = await supabase
      .from('talents')
      .update({
        department: department.trim() || null,
        position: position.trim() || null,
      })
      .eq('id', talent.id);
    if (talentError) {
      setError(databaseErrorMessage(talentError));
      setSaving(false);
      return;
    }

    if (!sameChoice(managers, initialChoice(talent))) {
      const { error: managerError } = await supabase.rpc('set_talent_managers', {
        talent_id: talent.id,
        manager_ids: managers.ids,
        primary_id: managers.primaryId,
      });
      if (managerError) {
        setError(databaseErrorMessage(managerError));
        setSaving(false);
        return;
      }
    }

    if (trimmedName !== talent.profile.full_name) {
      const { error: nameError } = await supabase
        .from('profiles')
        .update({ full_name: trimmedName })
        .eq('id', talent.profile_id);
      if (nameError) {
        setError(databaseErrorMessage(nameError));
        setSaving(false);
        return;
      }
    }
    onSaved();
  }

  return (
    <Modal title="Edit talent" description={talent.profile.email} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-6" noValidate>
        <FormField id="edit-talent-name" label="Full name">
          <input
            id="edit-talent-name"
            className="field-input"
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            maxLength={200}
            autoFocus
          />
        </FormField>

        <div className="grid gap-5 sm:grid-cols-2">
          <FormField id="edit-talent-department" label="Department">
            <input
              id="edit-talent-department"
              className="field-input"
              value={department}
              onChange={(event) => setDepartment(event.target.value)}
              maxLength={200}
            />
          </FormField>
          <FormField id="edit-talent-position" label="Position">
            <input
              id="edit-talent-position"
              className="field-input"
              value={position}
              onChange={(event) => setPosition(event.target.value)}
              maxLength={200}
            />
          </FormField>
        </div>

        <ManagerSelector
          id="edit-talent-managers"
          people={people}
          excludeId={talent.profile_id}
          value={managers}
          onChange={setManagers}
        />

        <p className="text-sm leading-relaxed text-ink-muted">
          Changing managers does not change anyone's role. Assessments not yet submitted for removed managers are removed;
          submitted feedback is kept.
        </p>

        {error && <Notice>{error}</Notice>}

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {saving ? 'Saving...' : 'Save changes'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
