import { useState, type FormEvent } from 'react';
import { ArrowLeft, Eye, EyeOff, Loader2 } from 'lucide-react';
import { useAuth } from '@/auth/useAuth';
import { FormError } from '@/components/AuthLayout';
import { BrandMark } from '@/components/BrandMark';
import {
  CODE_REQUESTED_MESSAGE,
  activateAccount,
  requestActivationCode,
} from '@/features/auth/activationRequests';

const MIN_PASSWORD_LENGTH = 12;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Step = { kind: 'email' } | { kind: 'code'; email: string };

export function ActivatePage() {
  const [step, setStep] = useState<Step>({ kind: 'email' });

  return (
    <main className="flex min-h-screen w-full flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-md space-y-8">
        <div className="flex justify-center">
          <BrandMark />
        </div>
        <section className="rounded-card border border-line bg-surface p-6 shadow-sm sm:p-8">
          {step.kind === 'email' ? (
            <EmailStep onCodeSent={(email) => setStep({ kind: 'code', email })} />
          ) : (
            <CodeStep email={step.email} onBack={() => setStep({ kind: 'email' })} />
          )}
        </section>
        <p className="text-center text-sm text-ink-muted">
          Already have an account?{' '}
          <a href="/" className="font-semibold text-primary underline-offset-4 hover:underline">
            Go to sign-in
          </a>
        </p>
      </div>
    </main>
  );
}

function EmailStep({ onCodeSent }: { onCodeSent: (email: string) => void }) {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = email.trim();
    if (!EMAIL_PATTERN.test(trimmed)) {
      setError('Enter your work email address.');
      return;
    }
    setSubmitting(true);
    setError(null);
    const result = await requestActivationCode(trimmed);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onCodeSent(trimmed.toLowerCase());
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
      <div className="space-y-2">
        <h1 className="text-2xl">Create your account</h1>
        <p className="text-sm leading-relaxed text-ink-muted">
          Enter the work email your invitation was sent to. We will email you a 6-digit code to set your password.
        </p>
      </div>
      <div className="space-y-2">
        <label htmlFor="activate-email" className="block text-sm font-semibold">
          Work email
        </label>
        <input
          id="activate-email"
          type="email"
          autoComplete="email"
          className="field-input"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
          required
        />
      </div>
      <FormError message={error} />
      <button type="submit" className="btn-accent w-full" disabled={submitting}>
        {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
        {submitting ? 'Sending...' : 'Send me a code'}
      </button>
    </form>
  );
}

function CodeStep({ email, onBack }: { email: string; onBack: () => void }) {
  const { signIn } = useAuth();
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(CODE_REQUESTED_MESSAGE);
  const [submitting, setSubmitting] = useState(false);

  function validate(): string | null {
    if (!/^[0-9]{6}$/.test(code.trim())) return 'Enter the 6-digit code from the email.';
    if (password.length < MIN_PASSWORD_LENGTH) {
      return `Your password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
    }
    if (password.toLowerCase() === email.toLowerCase()) return 'Your password cannot be your email address.';
    if (password !== confirmPassword) return 'The two passwords do not match.';
    return null;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setSubmitting(true);
    setError(null);
    setNotice(null);
    const result = await activateAccount(email, code.trim(), password);
    if (!result.ok) {
      setError(result.error);
      setSubmitting(false);
      return;
    }
    const signInError = await signIn(email, password);
    if (signInError) {
      setError(`Your account is ready. ${signInError}`);
      setSubmitting(false);
    }
  }

  async function handleResend() {
    setSubmitting(true);
    setError(null);
    const result = await requestActivationCode(email);
    setSubmitting(false);
    if (result.ok) setNotice(result.message);
    else setError(result.error);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-2 text-sm font-semibold text-ink-muted transition-colors duration-200 hover:text-ink"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Use a different email
      </button>
      <div className="space-y-2">
        <h1 className="text-2xl">Enter your code</h1>
        {notice && <p className="text-sm leading-relaxed text-ink-muted">{notice}</p>}
      </div>
      <div className="space-y-2">
        <label htmlFor="activation-code" className="block text-sm font-semibold">
          6-digit code
        </label>
        <input
          id="activation-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          className="field-input tracking-[0.4em]"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          required
        />
      </div>
      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-3">
          <label htmlFor="new-password" className="block text-sm font-semibold">
            Choose a password
          </label>
          <button
            type="button"
            onClick={() => setShowPasswords((value) => !value)}
            className="inline-flex items-center gap-1 text-sm font-semibold text-primary underline-offset-4 hover:underline"
          >
            {showPasswords ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
            {showPasswords ? 'Hide' : 'Show'}
          </button>
        </div>
        <input
          id="new-password"
          type={showPasswords ? 'text' : 'password'}
          autoComplete="new-password"
          className="field-input"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-describedby="password-hint"
          required
        />
        <p id="password-hint" className="text-xs text-ink-muted">
          At least {MIN_PASSWORD_LENGTH} characters. Do not use your email address.
        </p>
      </div>
      <div className="space-y-2">
        <label htmlFor="confirm-password" className="block text-sm font-semibold">
          Type it again
        </label>
        <input
          id="confirm-password"
          type={showPasswords ? 'text' : 'password'}
          autoComplete="new-password"
          className="field-input"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          required
        />
      </div>
      <FormError message={error} />
      <button type="submit" className="btn-accent w-full" disabled={submitting}>
        {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
        {submitting ? 'Creating your account...' : 'Create account'}
      </button>
      <button
        type="button"
        onClick={() => void handleResend()}
        disabled={submitting}
        className="w-full text-sm font-semibold text-primary underline-offset-4 hover:underline disabled:opacity-60"
      >
        Send a new code
      </button>
    </form>
  );
}
