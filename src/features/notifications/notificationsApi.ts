import { supabase } from '@/lib/supabase';

export type MyNotifications = {
  peer_suggestions: number;
  plans_to_release: number;
  forms_pending: { cycle: string; count: number; closes_at: string }[];
  new_shares: number;
  opened_shares: { id: string; person: string; cycle: string; kind: 'consolidated' | 'individual' }[];
};

export async function loadMyNotifications(): Promise<MyNotifications> {
  const { data, error } = await supabase.rpc('my_notifications');
  if (error) throw error;
  return data as MyNotifications;
}

/** Items that need action and make the red bubble count (opened shared reports don't). */
export function alertCount(n: MyNotifications): number {
  return n.peer_suggestions + n.plans_to_release + n.forms_pending.reduce((sum, f) => sum + f.count, 0) + n.new_shares;
}

export type NavTarget = { view: 'My assessments' | 'My team' | 'Workspace'; section?: string };

const NAV_EVENT = 'lc:navigate';
const CHANGED_EVENT = 'lc:notifications-changed';

// The tab or section may not be on screen yet (for example while My profile is open), so the target is kept until the
// screen that handles it mounts and takes its part.
let pending: Partial<NavTarget> = {};

/** Asks the home screen to switch to a tab (and Workspace section). */
export function navigateTo(target: NavTarget) {
  pending = { ...target };
  window.dispatchEvent(new Event(NAV_EVENT));
}

/** Returns and clears one part of the pending navigation target. */
export function takePendingNav<K extends keyof NavTarget>(key: K): NavTarget[K] | undefined {
  const value = pending[key];
  delete pending[key];
  return value;
}

/** Calls the handler whenever navigation is requested; the handler takes its part with takePendingNav. */
export function onNavigate(handler: () => void): () => void {
  window.addEventListener(NAV_EVENT, handler);
  return () => window.removeEventListener(NAV_EVENT, handler);
}

/** Tells the bell to refresh now (for example after a shared report is opened). */
export function notificationsChanged() {
  window.dispatchEvent(new Event(CHANGED_EVENT));
}

export function onNotificationsChanged(handler: () => void): () => void {
  window.addEventListener(CHANGED_EVENT, handler);
  return () => window.removeEventListener(CHANGED_EVENT, handler);
}

export async function markSharedReportOpened(cycleId: string, talentId: string) {
  await supabase.rpc('mark_shared_report_opened', { p_cycle_id: cycleId, p_talent_id: talentId });
  notificationsChanged();
}

export async function dismissSharedReport(shareId: string) {
  await supabase.rpc('dismiss_shared_report', { p_share_id: shareId });
}
