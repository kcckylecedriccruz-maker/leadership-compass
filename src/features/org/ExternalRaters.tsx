import { useState } from 'react';
import { Building2, Loader2, Plus, X } from 'lucide-react';
import { Notice } from '@/components/Notice';
import { addExternalRater, removeExternalRater, type OrgData, type OrgPerson } from '@/features/org/orgData';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Clients, partners or contractors who give this employee External feedback by secure link. They never get an
 * account. Saved on the employee and added to every cycle that includes External raters.
 */
export function ExternalRaters({
  org,
  employee,
  canManage,
  onChanged,
}: {
  org: OrgData;
  employee: OrgPerson;
  canManage: boolean;
  onChanged: () => void;
}) {
  const raters = org.externalsOf.get(employee.id) ?? [];
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [organisation, setOrganisation] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'error' | 'info'; text: string } | null>(null);

  async function add() {
    if (!name.trim()) return setMessage({ tone: 'error', text: 'Enter their name.' });
    if (!EMAIL_PATTERN.test(email.trim())) return setMessage({ tone: 'error', text: 'Enter a valid email address.' });
    setBusy('add');
    setMessage(null);
    const result = await addExternalRater({
      employee_id: employee.id,
      full_name: name.trim(),
      email: email.trim(),
      organisation: organisation.trim(),
    });
    setBusy(null);
    if (!result.ok) return setMessage({ tone: 'error', text: result.message });
    const added = Number(result.data.added_to_open_cycles ?? 0);
    setMessage({
      tone: 'info',
      text:
        added > 0
          ? `${name.trim()} was added and asked for feedback in ${added} open cycle${added === 1 ? '' : 's'}. They get their link with the next invitations.`
          : `${name.trim()} was added. They are included when a cycle with External raters opens.`,
    });
    setName('');
    setEmail('');
    setOrganisation('');
    setAdding(false);
    onChanged();
  }

  async function remove(rater: OrgPerson) {
    setBusy(rater.id);
    setMessage(null);
    const result = await removeExternalRater(employee.id, rater.id);
    setBusy(null);
    if (!result.ok) return setMessage({ tone: 'error', text: result.message });
    setMessage({ tone: 'info', text: `${rater.full_name} was removed. Feedback they already started is kept.` });
    onChanged();
  }

  return (
    <section className="space-y-3" aria-label="External raters">
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Building2 className="h-4 w-4 text-primary" aria-hidden="true" />
          External raters
        </h3>
        {canManage && !adding && (
          <button type="button" className="btn-secondary px-3 py-1.5 text-xs" onClick={() => setAdding(true)}>
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            Add
          </button>
        )}
      </div>
      <p className="text-xs text-ink-muted">
        Clients, partners or contractors. They answer by private email link, never get an account, and their feedback is
        anonymous in reports.
      </p>

      {raters.length === 0 ? (
        <p className="text-sm text-ink-muted">None yet.</p>
      ) : (
        <ul className="space-y-2">
          {raters.map((rater) => (
            <li key={rater.id} className="flex items-center gap-3 rounded-xl border border-line px-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{rater.full_name}</span>
                <span className="block truncate text-xs text-ink-muted">
                  {[rater.organisation, rater.email].filter(Boolean).join(' · ')}
                </span>
              </span>
              {canManage && (
                <button
                  type="button"
                  className="rounded-lg p-1.5 text-ink-muted hover:bg-muted hover:text-danger"
                  onClick={() => void remove(rater)}
                  disabled={busy !== null}
                  aria-label={`Remove ${rater.full_name}`}
                >
                  {busy === rater.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <X className="h-4 w-4" aria-hidden="true" />}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {adding && (
        <form
          className="space-y-3 rounded-xl border border-line p-3"
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
            placeholder="Email"
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
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary px-3 py-2" onClick={() => setAdding(false)} disabled={busy !== null}>
              Cancel
            </button>
            <button type="submit" className="btn-primary px-3 py-2" disabled={busy !== null}>
              {busy === 'add' && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              Add external rater
            </button>
          </div>
        </form>
      )}

      {message && <Notice tone={message.tone}>{message.text}</Notice>}
    </section>
  );
}
