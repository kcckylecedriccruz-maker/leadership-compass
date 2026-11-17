import { useState, type ReactNode } from 'react';
import { BookOpen, LogOut, Settings2 } from 'lucide-react';
import { useAuth } from '@/auth/useAuth';
import { BrandMark } from '@/components/BrandMark';
import { WelcomeTour } from '@/features/tour/WelcomeTour';
import { tourStepsFor } from '@/features/tour/tourSteps';
import type { Profile } from '@/lib/types';

const ROLE_LABELS: Record<Profile['role'], string> = {
  admin: 'Admin',
  manager: 'Manager',
  assessor: 'Assessor',
  talent: 'Talent',
};

export function AppShell({
  profile,
  children,
  onOpenNotifications,
}: {
  profile: Profile;
  children: ReactNode;
  /** Only passed for administrators: the Notifications module is admin-only. */
  onOpenNotifications?: () => void;
}) {
  const { signOut, markTourSeen } = useAuth();
  const [tourOpen, setTourOpen] = useState(profile.tour_seen_at === null);
  const roleLabel = [
    ROLE_LABELS[profile.role],
    profile.is_talent && profile.role !== 'talent' ? ROLE_LABELS.talent : null,
    profile.manages_talents && profile.role !== 'manager' ? 'Manager' : null,
  ]
    .filter(Boolean)
    .join(' · ');

  function closeTour() {
    setTourOpen(false);
    if (profile.tour_seen_at === null) void markTourSeen();
  }

  return (
    <div className="min-h-screen w-full">
      <header className="sticky top-0 z-20 border-b border-line bg-surface/95 backdrop-blur print:hidden">
        <div aria-hidden="true" className="flex h-1">
          <span className="flex-[3] bg-primary" />
          <span className="flex-1 bg-sky" />
          <span className="flex-1 bg-accent" />
        </div>
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <BrandMark compact />
          <div className="flex min-w-0 items-center gap-3">
            <div className="min-w-0 text-right">
              <p className="truncate text-sm font-semibold">{profile.full_name}</p>
              <p className="text-xs text-ink-muted">{roleLabel}</p>
            </div>
            <button
              type="button"
              onClick={() => setTourOpen(true)}
              className="btn-secondary shrink-0 px-3 py-2"
              aria-label="Welcome tour"
            >
              <BookOpen className="h-4 w-4" aria-hidden="true" />
              <span className="hidden md:inline">Welcome tour</span>
            </button>
{onOpenNotifications && (
            <button
              type="button"
              onClick={onOpenNotifications}
              className="btn-secondary shrink-0 px-3 py-2"
              aria-label="Notification settings"
            >
              <Settings2 className="h-4 w-4" aria-hidden="true" />
              <span className="hidden md:inline">Notifications</span>
            </button>
            )}
            <button
              type="button"
              onClick={() => void signOut()}
              className="btn-secondary shrink-0 px-3 py-2"
              aria-label="Sign out"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
        {children}
      </main>
      {tourOpen && <WelcomeTour steps={tourStepsFor(profile.role)} onClose={closeTour} />}
    </div>
  );
}
