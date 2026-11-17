import { useState, type FormEvent } from 'react';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/auth/useAuth';
import { AuthLayout, FormError } from '@/components/AuthLayout';

const MIN_PASSWORD_LENGTH = 8;

export function ChangePasswordPage() {
  const { changePassword, signOut } = useAuth();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Your new password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirmation) {
      setError('The two passwords do not match.');
      return;
    }
    setSubmitting(true);
    setError(null);
    const message = await changePassword(password);
    if (message) {
      setError(message);
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      title="Choose a new password"
      description="For your security, please set a new password of your own before you continue."
    >
      <form onSubmit={handleSubmit} className="space-y-5" noValidate>
        <div className="space-y-2">
          <label htmlFor="new-password" className="block text-sm font-semibold">
            New password
          </label>
          <input
            id="new-password"
            type="password"
            autoComplete="new-password"
            className="field-input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-describedby="password-hint"
            required
          />
          <p id="password-hint" className="text-xs text-ink-muted">
            At least {MIN_PASSWORD_LENGTH} characters.
          </p>
        </div>
        <div className="space-y-2">
          <label htmlFor="confirm-password" className="block text-sm font-semibold">
            Confirm new password
          </label>
          <input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            className="field-input"
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            required
          />
        </div>
        <FormError message={error} />
        <button type="submit" className="btn-accent w-full" disabled={submitting}>
          {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          {submitting ? 'Saving...' : 'Save password and continue'}
        </button>
      </form>
      <button
        type="button"
        onClick={() => void signOut()}
        className="mt-4 w-full text-center text-sm font-semibold text-primary underline-offset-4 hover:underline"
      >
        Sign out instead
      </button>
    </AuthLayout>
  );
}
