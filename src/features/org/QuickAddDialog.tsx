import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { Notice } from '@/components/Notice';
import { quickAddEmployee, type OrgData } from '@/features/org/orgData';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Adds an employee without sending an account invitation. They are rated and rate others by secure link straight
 * away, and can activate an account later to see their own report.
 */
export function QuickAddDialog({
  org,
  fixedManagerId,
  onClose,
  onDone,
}: {
  org: OrgData;
  /** Managers can only add their own direct reports. */
  fixedManagerId?: string;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [managerId, setManagerId] = useState(fixedManagerId ?? '');
  const [department, setDepartment] = useState('');
  const [position, setPosition] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const managers = org.people.filter((p) => p.is_active);

  async function submit() {
    if (!fullName.trim()) return setError('Enter their full name.');
    if (!EMAIL_PATTERN.test(email.trim())) return setError('Enter a valid work email address.');
    setBusy(true);
    setError(null);
    const result = await quickAddEmployee({
      full_name: fullName.trim(),
      email: email.trim(),
      manager_id: managerId || null,
      department: department.trim(),
      position: position.trim(),
    });
    setBusy(false);
    if (!result.ok) return setError(result.message);
    onDone(
      `${fullName.trim()} was added without an account invitation. They answer by secure link; refresh an open cycle's evaluations to include them now.`,
    );
  }

  return (
    <Modal
      title="Quick add employee"
      description="No account invitation is sent. They give and receive feedback by secure email link."
      onClose={onClose}
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        noValidate
      >
        <label className="block space-y-2">
          <span className="text-sm font-semibold">Full name</span>
          <input className="field-input" value={fullName} maxLength={200} onChange={(e) => setFullName(e.target.value)} autoComplete="off" />
        </label>
        <label className="block space-y-2">
          <span className="text-sm font-semibold">Work email</span>
          <input className="field-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
        </label>
        <label className="block space-y-2">
          <span className="text-sm font-semibold">Immediate manager</span>
          <select
            className="field-input"
            value={managerId}
            onChange={(e) => setManagerId(e.target.value)}
            disabled={Boolean(fixedManagerId)}
          >
            <option value="">No manager (top of the organisation)</option>
            {managers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name}
              </option>
            ))}
          </select>
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block space-y-2">
            <span className="text-sm font-semibold">Department (optional)</span>
            <input className="field-input" value={department} maxLength={100} onChange={(e) => setDepartment(e.target.value)} />
          </label>
          <label className="block space-y-2">
            <span className="text-sm font-semibold">Position (optional)</span>
            <input className="field-input" value={position} maxLength={100} onChange={(e) => setPosition(e.target.value)} />
          </label>
        </div>
        {error && <Notice>{error}</Notice>}
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            Add employee
          </button>
        </div>
      </form>
    </Modal>
  );
}
