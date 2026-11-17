import { useState, type FormEvent } from 'react';
import { Loader2 } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { Notice } from '@/components/Notice';
import { requestTemporaryPassword } from '@/features/auth/temporaryPassword';

type ForgotPasswordDialogProps = {
  initialEmail: string;
  onClose: () => void;
};

export function ForgotPasswordDialog({ initialEmail, onClose }: ForgotPasswordDialogProps) {
  const [email, setEmail] = useState(initialEmail);
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email.trim()) return;
    setSubmitting(true);
    setMessage(await requestTemporaryPassword(email));
    setSubmitting(false);
  }

  return (
    <Modal
      title="Forgot password?"
      description="Enter your work email and we will send a temporary password. You will choose a new one when you sign in."
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="space-y-5" noValidate>
        <div className="space-y-2">
          <label htmlFor="reset-email" className="block text-sm font-semibold">
            Work email
          </label>
          <input
            id="reset-email"
            type="email"
            autoComplete="email"
            className="field-input"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@company.com"
            required
          />
        </div>
        {message && <Notice tone="info">{message}</Notice>}
        <button type="submit" className="btn-primary w-full" disabled={submitting}>
          {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          {submitting ? 'Sending...' : 'Send temporary password'}
        </button>
      </form>
    </Modal>
  );
}
