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
};

type CyclePayload = {
  name: string;
  opens_at: string;
  closes_at: string;
  status: CycleStatus;
  reminder_every_days: number;
  alert_on_submit: boolean;
  min_group_size: number;
};

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
          <FormField id="cycle-status" label="Status" hint="Open makes the feedback forms available to assessors. Closed cycles no longer accept new assessors.">
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
