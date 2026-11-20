import { useCallback, useState } from 'react';
import { Loader2, Mail, UserRound } from 'lucide-react';
import { useAuth } from '@/auth/useAuth';
import { FormField } from '@/components/FormField';
import { Notice } from '@/components/Notice';
import { confirmOwnEmailChange, requestOwnEmailChange, updateOwnDetails } from '@/features/users/profileEdits';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/lib/types';
import { useAsyncData } from '@/lib/useAsyncData';
import { isValidEmail } from '@/lib/validation';

type Message = { tone: 'error' | 'info'; text: string } | null;

/** Everyone edits their own name, department and position, and changes their email with a code. */
export function MyProfilePage({ profile }: { profile: Profile }) {
  const load = useCallback(async () => {
    const { data } = await supabase.from('profiles').select('department, position').eq('id', profile.id).maybeSingle();
    return (data ?? { department: null, position: null }) as { department: string | null; position: string | null };
  }, [profile.id]);
  const { state } = useAsyncData(load);

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <p className="eyebrow">Your account</p>
        <h1 className="text-3xl sm:text-4xl">My profile</h1>
      </div>
      {state.status === 'loading' && <p className="text-sm text-ink-muted">Loading...</p>}
      {state.status === 'ready' && <DetailsForm profile={profile} initial={state.data} />}
      {state.status === 'error' && <Notice>We could not load your profile.</Notice>}
      <EmailForm profile={profile} />
      <p className="text-xs text-ink-muted">Your manager, groups and role are set by an administrator.</p>
    </div>
  );
}

function DetailsForm({ profile, initial }: { profile: Profile; initial: { department: string | null; position: string | null } }) {
  const { updateProfileLocally } = useAuth();
  const [fullName, setFullName] = useState(profile.full_name);
  const [department, setDepartment] = useState(initial.department ?? '');
  const [position, setPosition] = useState(initial.position ?? '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>(null);

  async function save() {
    if (!fullName.trim()) return setMessage({ tone: 'error', text: 'Enter your full name.' });
    setBusy(true);
    setMessage(null);
    const result = await updateOwnDetails({
      full_name: fullName.trim(),
      department: department.trim() || null,
      position: position.trim() || null,
    });
    setBusy(false);
    if (!result.ok) return setMessage({ tone: 'error', text: result.message });
    updateProfileLocally({ full_name: fullName.trim() });
    setMessage({ tone: 'info', text: 'Your details were saved.' });
  }

  return (
    <section className="space-y-5 rounded-card border border-line bg-surface p-5 sm:p-6" aria-labelledby="details-heading">
      <h2 id="details-heading" className="flex items-center gap-2 text-xl">
        <UserRound className="h-5 w-5 text-primary" aria-hidden="true" />
        Details
      </h2>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
        noValidate
      >
        <FormField id="me-name" label="Full name" hint="How your name appears in the app and in reports.">
          <input id="me-name" className="field-input" value={fullName} maxLength={200} onChange={(e) => setFullName(e.target.value)} />
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="me-department" label="Department">
            <input id="me-department" className="field-input" value={department} maxLength={100} onChange={(e) => setDepartment(e.target.value)} />
          </FormField>
          <FormField id="me-position" label="Position">
            <input id="me-position" className="field-input" value={position} maxLength={100} onChange={(e) => setPosition(e.target.value)} />
          </FormField>
        </div>
        {message && <Notice tone={message.tone}>{message.text}</Notice>}
        <div className="flex justify-end">
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            Save details
          </button>
        </div>
      </form>
    </section>
  );
}

function EmailForm({ profile }: { profile: Profile }) {
  const { updateProfileLocally } = useAuth();
  const [step, setStep] = useState<'idle' | 'enter' | 'code'>('idle');
  const [newEmail, setNewEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>(null);

  async function requestCode() {
    if (!isValidEmail(newEmail)) return setMessage({ tone: 'error', text: 'Enter a valid email address.' });
    setBusy(true);
    setMessage(null);
    const result = await requestOwnEmailChange(newEmail.trim());
    setBusy(false);
    if (!result.ok) return setMessage({ tone: 'error', text: result.message });
    setStep('code');
    setMessage({ tone: 'info', text: `We emailed a 6-digit code to ${newEmail.trim()}. It expires in 15 minutes.` });
  }

  async function confirm() {
    setBusy(true);
    setMessage(null);
    const result = await confirmOwnEmailChange(code);
    setBusy(false);
    if (!result.ok) return setMessage({ tone: 'error', text: result.message });
    const email = typeof result.data.email === 'string' ? result.data.email : newEmail.trim();
    updateProfileLocally({ email });
    setStep('idle');
    setCode('');
    setNewEmail('');
    setMessage({ tone: 'info', text: `Done. Sign in with ${email} from now on. A notice was sent to your old address too.` });
  }

  return (
    <section className="space-y-4 rounded-card border border-line bg-surface p-5 sm:p-6" aria-labelledby="email-heading">
      <h2 id="email-heading" className="flex items-center gap-2 text-xl">
        <Mail className="h-5 w-5 text-primary" aria-hidden="true" />
        Sign-in email
      </h2>
      <p className="text-sm">
        <span className="text-ink-muted">Current:</span> <span className="font-semibold">{profile.email}</span>
      </p>

      {step === 'idle' && (
        <button type="button" className="btn-secondary" onClick={() => setStep('enter')}>
          Change email
        </button>
      )}

      {step === 'enter' && (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void requestCode();
          }}
          noValidate
        >
          <FormField id="me-new-email" label="New email">
            <input id="me-new-email" type="email" className="field-input" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} autoComplete="email" />
          </FormField>
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            Send code
          </button>
          <button type="button" className="btn-secondary" onClick={() => setStep('idle')} disabled={busy}>
            Cancel
          </button>
        </form>
      )}

      {step === 'code' && (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void confirm();
          }}
          noValidate
        >
          <FormField id="me-code" label="6-digit code">
            <input
              id="me-code"
              className="field-input tracking-[0.3em]"
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              autoComplete="one-time-code"
            />
          </FormField>
          <button type="submit" className="btn-primary" disabled={busy || code.length !== 6}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            Confirm new email
          </button>
          <button type="button" className="btn-secondary" onClick={() => void requestCode()} disabled={busy}>
            Send a new code
          </button>
        </form>
      )}

      {message && <Notice tone={message.tone}>{message.text}</Notice>}
    </section>
  );
}
