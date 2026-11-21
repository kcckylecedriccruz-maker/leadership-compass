import type { Profile } from '@/lib/types';
import { TalentResults } from '@/features/reports/TalentResults';

export function HomePage({ profile }: { profile: Profile }) {
  const firstName = profile.full_name.split(' ')[0];

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <p className="text-sm font-semibold text-primary">Welcome back, {firstName}</p>
        <h1 className="text-3xl sm:text-4xl">Your development</h1>
        <p className="max-w-2xl text-base leading-relaxed text-ink-muted">
          Your assessment results and development summary appear here once each cycle closes.
          {profile.role === 'admin' && ' As an administrator, you can also see your report while a cycle is still open.'}
        </p>
      </div>
      <TalentResults />
    </div>
  );
}
