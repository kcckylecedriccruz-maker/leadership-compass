import { useState } from 'react';
import { Loader2, Plus, UserRoundSearch, X } from 'lucide-react';
import { Notice } from '@/components/Notice';
import {
  addOutsideEvaluator,
  addOutsidePerson,
  hasRealEmail,
  removeOutsideEvaluator,
  setOutsideEmail,
  type OrgData,
  type OrgPerson,
} from '@/features/org/orgData';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * People outside the organisation (contractors, partners, client contacts). Administrators choose which employees
 * evaluate each one; the choice carries over to every cycle with External people switched on. No self-assessment,
 * and their report is admin-only (it can be shared with an employee).
 */
export function OutsidePeople({ org, onChanged }: { org: OrgData; onChanged: () => void }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [organisation, setOrganisation] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'error' | 'info'; text: string } | null>(null);

  async function add() {
    if (!name.trim()) return setMessage({ tone: 'error', text: 'Enter their name.' });
    // Email is optional: it is only needed if they will also give feedback.
    if (email.trim() && !EMAIL_PATTERN.test(email.trim())) return setMessage({ tone: 'error', text: 'Enter a valid email address, or leave it empty.' });
    setBusy('add');
    setMessage(null);
    const result = await addOutsidePerson({ full_name: name.trim(), email: email.trim() || null, organisation: organisation.trim() });
    setBusy(null);
    if (!result.ok) return setMessage({ tone: 'error', text: result.message });
    setMessage({ tone: 'info', text: `${name.trim()} was added. Now choose the employees who evaluate them.` });
    setName('');
    setEmail('');
    setOrganisation('');
    setAdding(false);
    onChanged();
  }

  return (
    <section className="space-y-4 rounded-card border border-line bg-surface p-5" aria-labelledby="outside-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h3 id="outside-heading" className="flex items-center gap-2 text-lg">
            <UserRoundSearch className="h-5 w-5 text-primary" aria-hidden="true" />
            Outside people
          </h3>
          <p className="max-w-3xl text-sm text-ink-muted">
            Contractors, partners or client contacts. Choose the employees who evaluate each one; it carries over to every
            cycle with External people switched on. They do no self-assessment, never get an account, and their report is
            for administrators (you can share it with an employee). An email is only needed if they will also give feedback
            to employees as external raters.
          </p>
        </div>
        {!adding && (
          <button type="button" className="btn-secondary" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add outside person
          </button>
        )}
      </div>

      {adding && (
        <form
          className="grid gap-3 rounded-xl border border-line p-3 sm:grid-cols-3"
          onSubmit={(event) => {
            event.preventDefault();
            void add();
          }}
          noValidate
        >
          <input className="field-input" placeholder="Full name" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
          <input
            className="field-input"
            type="email"
            placeholder="Email (only if they'll give feedback)"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="off"
          />
          <input
            className="field-input"
            placeholder="Organisation (optional)"
            value={organisation}
            maxLength={100}
            onChange={(e) => setOrganisation(e.target.value)}
          />
          <div className="flex justify-end gap-2 sm:col-span-3">
            <button type="button" className="btn-secondary px-3 py-2" onClick={() => setAdding(false)} disabled={busy !== null}>
              Cancel
            </button>
            <button type="submit" className="btn-primary px-3 py-2" disabled={busy !== null}>
              {busy === 'add' && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              Add outside person
            </button>
          </div>
        </form>
      )}

      {message && <Notice tone={message.tone}>{message.text}</Notice>}

      {org.outsiders.length === 0 ? (
        <p className="text-sm text-ink-muted">No outside people yet.</p>
      ) : (
        <ul className="space-y-3">
          {org.outsiders.map((person) => (
            <OutsiderRow key={person.id} org={org} person={person} onChanged={onChanged} />
          ))}
        </ul>
      )}
    </section>
  );
}

function OutsiderRow({ org, person, onChanged }: { org: OrgData; person: OrgPerson; onChanged: () => void }) {
  const evaluators = org.evaluatorsOf.get(person.id) ?? [];
  const ratesFor = [...org.externalsOf.entries()]
    .filter(([, raters]) => raters.some((r) => r.id === person.id))
    .map(([employeeId]) => org.byId.get(employeeId)?.full_name)
    .filter(Boolean);
  const taken = new Set(evaluators.map((e) => e.id));
  const options = org.people.filter((p) => p.is_active && !taken.has(p.id));
  const [choice, setChoice] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'error' | 'info'; text: string } | null>(null);

  async function add() {
    if (!choice) return;
    setBusy(true);
    setMessage(null);
    const result = await addOutsideEvaluator(person.id, choice);
    setBusy(false);
    if (!result.ok) return setMessage({ tone: 'error', text: result.message });
    const who = org.byId.get(choice)?.full_name ?? 'They';
    setMessage({
      tone: 'info',
      text: result.added > 0 ? `${who} now evaluates ${person.full_name}, including ${result.added} open cycle${result.added === 1 ? '' : 's'}.` : `${who} will evaluate ${person.full_name} from the next cycle.`,
    });
    setChoice('');
    onChanged();
  }

  async function remove(evaluator: OrgPerson) {
    setBusy(true);
    setMessage(null);
    const result = await removeOutsideEvaluator(person.id, evaluator.id);
    setBusy(false);
    if (!result.ok) return setMessage({ tone: 'error', text: result.message });
    onChanged();
  }

  return (
    <li className="space-y-3 rounded-xl border border-line p-4">
      <div>
        <p className="font-semibold">{person.full_name}</p>
        <p className="text-xs text-ink-muted">
          {[person.organisation, hasRealEmail(person.email) ? person.email : 'No email (only being assessed)'].filter(Boolean).join(' · ')}
        </p>
        {!hasRealEmail(person.email) && <AddEmail person={person} onChanged={onChanged} />}
        {ratesFor.length > 0 && <p className="mt-1 text-xs text-ink-muted">Also gives feedback to: {ratesFor.join(', ')}</p>}
      </div>
      <div className="space-y-2">
        <p className="text-sm font-semibold">Evaluated by</p>
        {evaluators.length === 0 ? (
          <p className="text-sm text-ink-muted">No one yet.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {evaluators.map((evaluator) => (
              <li key={evaluator.id} className="inline-flex items-center gap-1 rounded-full border border-line py-1 pl-3 pr-1 text-sm">
                {evaluator.full_name}
                <button
                  type="button"
                  className="rounded-full p-1 text-ink-muted hover:bg-muted hover:text-danger"
                  onClick={() => void remove(evaluator)}
                  disabled={busy}
                  aria-label={`Stop ${evaluator.full_name} evaluating ${person.full_name}`}
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void add();
          }}
        >
          <select className="field-input min-w-0 flex-1" value={choice} onChange={(e) => setChoice(e.target.value)} aria-label="Choose an employee">
            <option value="">Choose an employee…</option>
            {options.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name}
                {p.position ? ` · ${p.position}` : ''}
              </option>
            ))}
          </select>
          <button type="submit" className="btn-secondary px-3 py-2" disabled={busy || !choice}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            Add evaluator
          </button>
        </form>
      </div>
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
    </li>
  );
}

/** An email is only needed when the outside person will also give feedback (as an external rater). */
function AddEmail({ person, onChanged }: { person: OrgPerson; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button type="button" className="mt-1 text-xs font-semibold text-primary underline underline-offset-4" onClick={() => setOpen(true)}>
        Add email so they can also give feedback
      </button>
    );
  }

  async function save() {
    if (!EMAIL_PATTERN.test(value.trim())) return setError('Enter a valid email address.');
    setBusy(true);
    setError(null);
    const result = await setOutsideEmail(person.id, value.trim());
    setBusy(false);
    if (!result.ok) return setError(result.message);
    setOpen(false);
    onChanged();
  }

  return (
    <form
      className="mt-2 flex flex-wrap gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
      noValidate
    >
      <input
        className="field-input min-w-0 flex-1"
        type="email"
        placeholder="Their email"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        autoComplete="off"
        aria-label={`Email for ${person.full_name}`}
      />
      <button type="submit" className="btn-secondary px-3 py-2" disabled={busy}>
        {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
        Save email
      </button>
      <button type="button" className="btn-secondary px-3 py-2" onClick={() => setOpen(false)} disabled={busy}>
        Cancel
      </button>
      {error && <p className="w-full text-xs text-danger">{error}</p>}
    </form>
  );
}
