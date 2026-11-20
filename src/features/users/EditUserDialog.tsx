import { useMemo, useState } from 'react';
import { Loader2, Users } from 'lucide-react';
import { FormField } from '@/components/FormField';
import { Modal } from '@/components/Modal';
import { Notice } from '@/components/Notice';
import { adminUpdateDetails } from '@/features/users/profileEdits';
import type { ManagedUser, UserGroup } from '@/features/users/userControl';
import { isValidEmail } from '@/lib/validation';

/** Administrators edit everything about a person's account in one form. */
export function EditUserDialog({
  user,
  users,
  groups,
  onClose,
  onDone,
}: {
  user: ManagedUser;
  users: ManagedUser[];
  groups: UserGroup[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [fullName, setFullName] = useState(user.full_name);
  const [email, setEmail] = useState(user.email);
  const [department, setDepartment] = useState(user.department ?? '');
  const [position, setPosition] = useState(user.position ?? '');
  const [managerId, setManagerId] = useState(user.manager_id ?? '');
  const [groupIds, setGroupIds] = useState<string[]>(user.groupIds);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Anyone below this person cannot become their manager (that would be a loop).
  const blocked = useMemo(() => {
    const below = new Set<string>();
    const queue = [user.id];
    while (queue.length > 0) {
      const current = queue.shift() as string;
      for (const person of users) {
        if (person.manager_id === current && !below.has(person.id)) {
          below.add(person.id);
          queue.push(person.id);
        }
      }
    }
    return below;
  }, [users, user.id]);
  const managers = users.filter((p) => p.is_active && !p.deletion_requested_at && p.id !== user.id && !blocked.has(p.id));
  const emailChanged = email.trim().toLowerCase() !== user.email.toLowerCase();

  async function save() {
    if (!fullName.trim()) return setError('Enter a full name.');
    if (!isValidEmail(email)) return setError('Enter a valid email address.');
    setBusy(true);
    setError(null);
    const result = await adminUpdateDetails(user.id, {
      full_name: fullName.trim(),
      email: email.trim(),
      department: department.trim() || null,
      position: position.trim() || null,
      manager_id: managerId || null,
      group_ids: groupIds,
    });
    setBusy(false);
    if (!result.ok) return setError(result.message);
    const changed = Array.isArray(result.data.changed) ? (result.data.changed as string[]) : [];
    onDone(
      changed.length === 0
        ? 'Nothing changed.'
        : changed.includes('email')
          ? `${fullName.trim()}'s details were saved. They now sign in with ${email.trim()}; both addresses were notified.`
          : `${fullName.trim()}'s details were saved.`,
    );
  }

  return (
    <Modal title={`Edit ${user.full_name}`} description="Changes apply right away." onClose={onClose}>
      <form
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
        noValidate
      >
        <FormField id="edit-name" label="Full name">
          <input id="edit-name" className="field-input" value={fullName} maxLength={200} onChange={(e) => setFullName(e.target.value)} />
        </FormField>
        <FormField
          id="edit-email"
          label="Work email (sign-in)"
          hint={emailChanged ? 'They will sign in with the new email straight away. Both addresses get a notice.' : undefined}
        >
          <input id="edit-email" type="email" className="field-input" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="edit-department" label="Department">
            <input id="edit-department" className="field-input" value={department} maxLength={100} onChange={(e) => setDepartment(e.target.value)} />
          </FormField>
          <FormField id="edit-position" label="Position">
            <input id="edit-position" className="field-input" value={position} maxLength={100} onChange={(e) => setPosition(e.target.value)} />
          </FormField>
        </div>
        <FormField id="edit-manager" label="Immediate manager" hint="Changes apply to open cycles when their evaluations are refreshed.">
          <select id="edit-manager" className="field-input" value={managerId} onChange={(e) => setManagerId(e.target.value)}>
            <option value="">No manager (top of the organisation)</option>
            {managers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name}
                {p.position ? ` · ${p.position}` : ''}
              </option>
            ))}
          </select>
        </FormField>

        <fieldset className="space-y-2">
          <legend className="mb-1 flex items-center gap-2 text-sm font-semibold">
            <Users className="h-4 w-4" aria-hidden="true" />
            Groups
          </legend>
          {groups.length === 0 ? (
            <p className="text-sm text-ink-muted">No groups yet. Create them with Groups in User control.</p>
          ) : (
            <>
              <p className="text-xs text-ink-muted">Choose any number of groups.</p>
              <div className="flex flex-wrap gap-2">
                {groups.map((group) => {
                  const on = groupIds.includes(group.id);
                  return (
                    <button
                      key={group.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setGroupIds((ids) => (on ? ids.filter((id) => id !== group.id) : [...ids, group.id]))}
                      className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                        on ? 'border-primary bg-primary text-on-primary' : 'border-line text-ink-muted hover:text-ink'
                      }`}
                    >
                      {group.name}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </fieldset>

        {error && <Notice>{error}</Notice>}
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            Save changes
          </button>
        </div>
      </form>
    </Modal>
  );
}
