import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ supabase: { rpc: () => Promise.resolve({}) } }));

import { safePath } from '@/lib/telemetry';

describe('analytics privacy', () => {
  it('never records a secure-link token', () => {
    expect(safePath('/e/0b1c2d3e-0000-4000-8000-000000000000.2.secretSignature')).toBe('/e/[link]');
    expect(safePath('/')).toBe('/');
    expect(safePath('/activate')).toBe('/activate');
  });
});
