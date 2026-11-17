import type { ReactNode } from 'react';

export type BadgeTone = 'neutral' | 'success' | 'warning';

const TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: 'text-ink-muted',
  success: 'text-band-strength',
  warning: 'text-band-developing',
};

export function Badge({ tone, children }: { tone: BadgeTone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full bg-muted px-2.5 py-1 text-xs font-semibold ${TONE_CLASSES[tone]}`}
    >
      {children}
    </span>
  );
}
