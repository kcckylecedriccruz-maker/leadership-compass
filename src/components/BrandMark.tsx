export const APP_NAME = 'Leadership Compass';

/** Compass mark in Formidea blue with a red needle, matching the favicon. */
function CompassIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <circle cx="32" cy="32" r="18" fill="none" stroke="currentColor" strokeWidth="4" />
      <path d="M32 18 L38 32 L32 46 L26 32 Z" fill="currentColor" />
      <path d="M32 18 L38 32 L32 32 Z" fill="#d83024" />
      <path d="M32 18 L26 32 L32 32 Z" fill="#ff5a4d" />
    </svg>
  );
}

export function BrandMark({ compact = false, inverted = false }: { compact?: boolean; inverted?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <span
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
          inverted ? 'bg-white/10 text-white ring-1 ring-white/25' : 'bg-primary text-on-primary'
        }`}
      >
        <CompassIcon className="h-7 w-7" />
      </span>
      <span className="leading-tight">
        <span className={`block font-bold ${compact ? 'text-sm' : 'text-base'} ${inverted ? 'text-white' : 'text-ink'}`}>
          {APP_NAME}
        </span>
        <span className={`block text-[10px] font-semibold uppercase tracking-[0.18em] ${inverted ? 'text-white/70' : 'text-ink-muted'}`}>
          by Formidea
        </span>
      </span>
    </div>
  );
}
