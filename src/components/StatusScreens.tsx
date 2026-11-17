import { CircleAlert, Loader2 } from 'lucide-react';
import { BrandMark } from '@/components/BrandMark';

export function LoadingScreen() {
  return (
    <main className="flex min-h-screen w-full flex-col items-center justify-center gap-6 px-4">
      <BrandMark />
      <p role="status" className="flex items-center gap-2 text-sm text-ink-muted">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        Loading your workspace...
      </p>
    </main>
  );
}

export function ErrorScreen({ message, onSignOut }: { message: string; onSignOut: () => void }) {
  return (
    <main className="flex min-h-screen w-full flex-col items-center justify-center gap-6 px-4">
      <BrandMark />
      <section className="w-full max-w-md rounded-card border border-line bg-surface p-6 text-center shadow-sm sm:p-8">
        <CircleAlert className="mx-auto h-10 w-10 text-danger" aria-hidden="true" />
        <h1 className="mt-4 text-xl">We could not open your workspace</h1>
        <p role="alert" className="mt-2 text-sm leading-relaxed text-ink-muted">
          {message}
        </p>
        <button type="button" onClick={onSignOut} className="btn-secondary mt-6 w-full">
          Back to sign in
        </button>
      </section>
    </main>
  );
}
