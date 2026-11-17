import { SignInForm } from '@/features/auth/SignInForm';

// One sign-in for everyone: what a person sees afterwards comes from their role
// and the module access an administrator gave them.
export function SignInPanel() {
  return (
    <section
      aria-labelledby="sign-in-heading"
      className="w-full rounded-card border border-line bg-surface p-6 shadow-sm sm:p-8"
    >
      <h2 id="sign-in-heading" className="text-2xl">
        Sign in
      </h2>
      <div className="mt-6 space-y-6">
        <p className="text-sm leading-relaxed text-ink-muted">
          Use the work email your administrator registered for you.
        </p>
        <SignInForm />
        <p className="text-center text-sm text-ink-muted">
          Invited but no password yet?{' '}
          <a href="/activate" className="font-semibold text-primary underline-offset-4 hover:underline">
            Create your account
          </a>
        </p>
      </div>
    </section>
  );
}
