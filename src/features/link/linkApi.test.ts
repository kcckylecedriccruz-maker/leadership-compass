import { describe, expect, it } from 'vitest';
import { linkTokenFromPath } from '@/features/link/linkApi';

describe('secure feedback link routing', () => {
  it('reads the token from /e/<token>', () => {
    const token = '0b1c2d3e-0000-4000-8000-000000000000.2.abcDEF_-123';
    expect(linkTokenFromPath(`/e/${token}`)).toBe(token);
    expect(linkTokenFromPath(`/e/${token}/`)).toBe(token);
  });

  it('ignores every other path', () => {
    expect(linkTokenFromPath('/')).toBeNull();
    expect(linkTokenFromPath('/activate')).toBeNull();
    expect(linkTokenFromPath('/e/')).toBeNull();
    expect(linkTokenFromPath('/e/abc/extra')).toBeNull();
  });
});
