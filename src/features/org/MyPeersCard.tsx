import { Notice } from '@/components/Notice';
import { PeerManager } from '@/features/org/PeerManager';
import { loadOrg } from '@/features/org/orgData';
import type { Profile } from '@/lib/types';
import { useAsyncData } from '@/lib/useAsyncData';

/** Employees suggest colleagues to give them Peer feedback; their immediate manager approves. */
export function MyPeersCard({ profile }: { profile: Profile }) {
  const { state, reload } = useAsyncData(loadOrg);

  if (state.status === 'loading') return null;
  if (state.status === 'error') return <Notice>We could not load your peers.</Notice>;
  const me = state.data.byId.get(profile.id);
  if (!me || me.exclude_rated) return null;

  return (
    <section className="rounded-card border border-line bg-surface p-5" aria-label="My peers">
      <PeerManager org={state.data} employee={me} canManage={profile.role === 'admin'} selfMode onChanged={reload} />
    </section>
  );
}
