import { useState, type FormEvent } from 'react';
import { Loader2 } from 'lucide-react';
import { FormField } from '@/components/FormField';
import { Modal } from '@/components/Modal';
import { Notice } from '@/components/Notice';
import { CYCLE_STATUS_LABELS, toDateInputValue } from '@/lib/format';
import { databaseErrorMessage } from '@/lib/errors';
import { CYCLE_STATUSES, type CycleRecord, type CycleStatus } from '@/lib/records';
import { supabase } from '@/lib/supabase';
import { parseWholeNumber } from '@/lib/validation';

type CycleDialogProps = {
  cycle: CycleRecord | null;
  onClose: () => void;
  onSaved: () => void;
};

type FormValues = {
  name: string;
  opensOn: string;
  closesOn: string;
  status: CycleStatus;
  reminderDays: string;
  alertOnSubmit: boolean;
  minGroupSize: string;
  include: Record<IncludeKey, boolean>;
};

// Which evaluations this cycle builds from the org structure (all on by default).
type IncludeKey = 'include_self' | 'include_manager' | 'include_skip_level' | 'include_upward' | 'include_upward_skip' | 'include_peers' | 'include_external';

const INCLUDE_OPTIONS: { key: IncludeKey; label: string; help: string }[] = [
  { key: 'include_self', label: 'Self', help: 'Each employee assesses themselves' },
  { key: 'include_manager', label: 'Immediate manager', help: 'Managers assess their direct reports' },
  { key: 'include_skip_level', label: 'Skip-level manager', help: 'The manager’s manager assesses the employee' },
  { key: 'include_upward', label: 'Upward to manager', help: 'Employees assess their immediate manager' },
  { key: 'include_upward_skip', label: 'Upward to skip-level', help: 'Employees assess their manager’s manager' },
  { key: 'include_peers', label: 'Peers', help: 'Approved peers assess the employee' },
  { key: 'include_external', label: 'External raters', help: 'Clients, partners or contractors added to an employee give feedback by secure link' },
];

const ALL_INCLUDED: Record<IncludeKey, boolean> = {
  include_self: true,
  include_manager: true,
  include_skip_level: true,
  include_upward: true,
  include_upward_skip: true,
  include_peers: true,
  include_external: true,
};

type CyclePayload = {
  name: string;
  opens_at: string;
  closes_at: string;
  status: CycleStatus;
  reminder_every_days: number;
  alert_on_submit: boolean;
  min_group_size: number;
} & Record<IncludeKey, boolean>;

type Validation = { ok: true; payload: CyclePayload } | { ok: false; message: string };

function initialValues(cycle: CycleRecord | null): FormValues {
  if (!cycle) {
    return {
      name: '',
      opensOn: '',
      closesOn: '',
      status: 'draft',
      reminderDays: '7',
      alertOnSubmit: true,
      minGroupSize: '3',
      include: { ...ALL_INCLUDED },
    };
  }
  return {
    name: cycle.name,
    opensOn: toDateInputValue(cycle.opens_at),
    closesOn: toDateInputValue(cycle.closes_at),
    status: cycle.status,
    reminderDays: String(cycle.reminder_every_days),
    alertOnSubmit: cycle.alert_on_submit,
    minGroupSize: String(cycle.min_group_size),
    include: {
      include_self: cycle.include_self ?? true,
      include_manager: cycle.include_manager ?? true,
      include_skip_level: cycle.include_skip_level ?? true,
      include_upward: cycle.include_upward ?? true,
      include_upward_skip: cycle.include_upward_skip ?? true,
      include_peers: cycle.include_peers ?? true,
      include_external: cycle.include_external ?? true,
    },
  };
}

function validate(values: FormValues): Validation {
  const name = values.name.trim();
  if (!name) return { ok: false, message: 'Give the cycle a name.' };
  if (!values.opensOn || !values.closesOn) return { ok: false, message: 'Choose both an open date and a close date.' };
  if (values.closesOn <= values.opensOn) {
    return { ok: false, message: 'The close date must be after the open date.' };
  }

  const reminderDays = parseWholeNumber(values.reminderDays, 1);
  if (reminderDays === null) return { ok: false, message: 'Reminders must be sent every one day or more.' };

  const minGroupSize = parseWholeNumber(values.minGroupSize, 1);
  if (minGroupSize === null) return { ok: false, message: 'The minimum group size must be one or more.' };

  return {
    ok: true,
    payload: {
      name,
      opens_at: `${values.opensOn}T00:00:00Z`,
      closes_at: `${values.closesOn}T23:59:59Z`,
      status: values.status,
      reminder_every_days: reminderDays,
      alert_on_submit: values.alertOnSubmit,
      min_group_size: minGroupSize,
      ...values.include,
    },
  };
}

export function CycleDialog({ cycle, onClose, onSaved }: CycleDialogProps) {
  const [values, setValues] = useState<FormValues>(() => initialValues(cycle));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function update<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setValues((previous) => ({ ...previous, [key]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = validate(values);
    if (!result.ok) {
      setError(result.message);
      return;
    }

    setSaving(true);
    setError(null);
    const { error: saveError } = cycle
      ? await supabase.from('cycles').update(result.payload).eq('id', cycle.id)
      : await supabase.from('cycles').insert(result.payload);

    if (saveError) {
      setError(databaseErrorMessage(saveError));
      setSaving(false);
      return;
    }
    onSaved();
  }

  return (
    <Modal
      title={cycle ? 'Edit cycle' : 'New cycle'}
      description="Dates, reminders and anonymity settings for this round of assessments."
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="space-y-6" noValidate>
        <FormField id="cycle-name" label="Cycle name">
          <input
            id="cycle-name"
            className="field-input"
            value={values.name}
            onChange={(event) => update('name', event.target.value)}
            maxLength={200}
            placeholder="Spring leadership review"
            autoFocus
          />
        </FormField>

        <div className="grid gap-5 sm:grid-cols-2">
          <FormField id="cycle-opens" label="Opens on">
            <input
              id="cycle-opens"
              type="date"
              className="field-input"
              value={values.opensOn}
              onChange={(event) => update('opensOn', event.target.value)}
            />
          </FormField>
          <FormField id="cycle-closes" label="Closes on">
            <input
              id="cycle-closes"
              type="date"
              className="field-input"
              value={values.closesOn}
              onChange={(event) => update('closesOn', event.target.value)}
            />
          </FormField>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <FormField id="cycle-status" label="Status" hint="Opening creates every evaluation from the org structure and makes the forms available. Closed cycles no longer change.">
            <select
              id="cycle-status"
              className="field-input"
              value={values.status}
              onChange={(event) => update('status', event.target.value as CycleStatus)}
            >
              {CYCLE_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {CYCLE_STATUS_LABELS[status]}
                </option>
              ))}
            </select>
          </FormField>
          <FormField
            id="cycle-reminders"
            label="Reminder every (days)"
            hint="How often assessors who have not finished receive a reminder."
          >
            <input
              id="cycle-reminders"
              type="number"
              min={1}
              inputMode="numeric"
              className="field-input"
              value={values.reminderDays}
              onChange={(event) => update('reminderDays', event.target.value)}
            />
          </FormField>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <FormField
            id="cycle-group"
            label="Minimum group size"
            hint="The smallest number of responses shown together, to protect anonymity."
          >
            <input
              id="cycle-group"
              type="number"
              min={1}
              inputMode="numeric"
              className="field-input"
              value={values.minGroupSize}
              onChange={(event) => update('minGroupSize', event.target.value)}
            />
          </FormField>
          <div className="flex items-end">
            <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-sm font-semibold">
              <input
                type="checkbox"
                className="h-4 w-4 accent-primary"
                checked={values.alertOnSubmit}
                onChange={(event) => update('alertOnSubmit', event.target.checked)}
              />
              Send an alert when an assessor submits
            </label>
          </div>
        </div>

        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-semibold">Evaluations this cycle creates from the org structure</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {INCLUDE_OPTIONS.map((option) => (
              <label key={option.key} className="flex cursor-pointer items-start gap-3 rounded-xl border border-line p-3">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 accent-primary"
                  checked={values.include[option.key]}
                  onChange={(event) => update('include', { ...values.include, [option.key]: event.target.checked })}
                />
                <span>
                  <span className="block text-sm font-semibold">{option.label}</span>
                  <span className="block text-xs text-ink-muted">{option.help}</span>
                </span>
              </label>
            ))}
          </div>
          <p className="text-xs text-ink-muted">
            Evaluations are created when the cycle opens. Changes made later apply after Refresh evaluations on the cycle.
          </p>
        </fieldset>

        {error && <Notice>{error}</Notice>}

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {saving ? 'Saving...' : 'Save cycle'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
