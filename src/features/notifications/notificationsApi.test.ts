import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ supabase: {} }));

import { alertCount, navigateTo, takePendingNav, type MyNotifications } from '@/features/notifications/notificationsApi';

const base: MyNotifications = { peer_suggestions: 0, plans_to_release: 0, forms_pending: [], new_shares: 0, opened_shares: [] };

describe('alertCount', () => {
  it('adds pending items but not opened shared reports', () => {
    const n: MyNotifications = {
      ...base,
      peer_suggestions: 2,
      plans_to_release: 1,
      forms_pending: [
        { cycle: 'A', count: 3, closes_at: '2026-12-01' },
        { cycle: 'B', count: 1, closes_at: '2026-12-15' },
      ],
      new_shares: 1,
      opened_shares: [{ id: 'x', person: 'P', cycle: 'A', kind: 'individual' }],
    };
    expect(alertCount(n)).toBe(8);
    expect(alertCount(base)).toBe(0);
  });
});

describe('navigation hand-off', () => {
  it('keeps each part until the screen that handles it takes it', () => {
    vi.stubGlobal('window', new EventTarget());
    navigateTo({ view: 'Workspace', section: 'dashboard' });
    expect(takePendingNav('view')).toBe('Workspace');
    expect(takePendingNav('view')).toBeUndefined();
    expect(takePendingNav('section')).toBe('dashboard');
    navigateTo({ view: 'My team' });
    expect(takePendingNav('section')).toBeUndefined();
    vi.unstubAllGlobals();
  });
});
