import type { ReactNode } from 'react';

type NoticeProps = {
  tone?: 'error' | 'info';
  children: ReactNode;
};

export function Notice({ tone = 'error', children }: NoticeProps) {
  const toneClasses = tone === 'error' ? 'bg-danger-soft text-danger' : 'bg-muted text-ink';
  return (
    <div role={tone === 'error' ? 'alert' : undefined} className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${toneClasses}`}>
      {children}
    </div>
  );
}
