import { useState, type FormEvent } from 'react';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/auth/useAuth';
import { FormError } from '@/components/AuthLayout';
import { ForgotPasswordDialog } from '@/features/auth/ForgotPasswordDialog';

export function SignInForm() {
  const { signIn, signInNotice } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email.trim() || !password) {
      setError('Enter your email and password.');
      return;
    }
    setSubmitting(true);
    setError(null);
    const message = await signIn(email, password);
    if (message) {
      setError(message);
      setSubmitting(false);
    }
  }

  const shownError = error ?? signInNotice;

  return (
    <>
      <form onSubmit={handleSubmit} className="space-y-5" noValidate>
        <div className="space-y-2">
          <label htmlFor="email" className="block text-sm font-semibold">
            Work email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            className="field-input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            required
          />
        </div>
        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-3">
            <label htmlFor="password" className="block text-sm font-semibold">
              Password
            </label>
            <button
              type="button"
              onClick={() => setForgotOpen(true)}
              className="text-sm font-semibold text-primary underline-offset-4 transition-colors duration-200 hover:underline"
            >
              Forgot password?
            </button>
          </div>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            className="field-input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        <FormError message={shownError} />
        <button type="submit" className="btn-accent w-full" disabled={submitting}>
          {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          {submitting ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
      {forgotOpen && <ForgotPasswordDialog initialEmail={email} onClose={() => setForgotOpen(false)} />}
    </>
  );
}
