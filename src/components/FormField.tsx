import type { ReactNode } from 'react';

type FormFieldProps = {
  id: string;
  label: string;
  hint?: string;
  children: ReactNode;
};

export function FormField({ id, label, hint, children }: FormFieldProps) {
  return (
    <div className="min-w-0 space-y-2">
      <label htmlFor={id} className="block text-sm font-semibold">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs leading-relaxed text-ink-muted">{hint}</p>}
    </div>
  );
}
