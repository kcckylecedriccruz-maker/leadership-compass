import type { ReactNode } from 'react';
import { BrandMark } from '@/components/BrandMark';

export function AuthLayout({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <main className="flex min-h-screen w-full flex-col items-center justify-center px-4 py-12">
      <div className="mb-8">
        <BrandMark />
      </div>
      <section className="w-full max-w-md rounded-card border border-line bg-surface p-6 shadow-sm sm:p-8">
        <h1 className="text-2xl">{title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">{description}</p>
        <div className="mt-6">{children}</div>
      </section>
    </main>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-xl bg-danger-soft px-4 py-3 text-sm leading-relaxed text-danger">
      {message}
    </p>
  );
}
