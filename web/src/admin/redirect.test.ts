import { describe, expect, it } from 'vitest';
import { loginReason, loginTarget, safeAdminPath } from './redirect';

describe('safeAdminPath', () => {
  it.each([
    ['/admin', '/admin'],
    ['/admin/', '/admin/'],
    ['/admin/certificates', '/admin/certificates'],
    ['/admin/certificates?page=2#top', '/admin/certificates?page=2#top'],
    ['/admin?x=1', '/admin?x=1'],
  ])('accepts %s', (input, expected) => {
    expect(safeAdminPath(input)).toBe(expected);
  });

  it.each([
    'https://evil.test',
    'https://evil.test/admin',
    '//evil.test/admin',
    '/\\evil.test',
    '/admin\\..\\evil',
    'javascript:alert(1)',
    '/administrator',
    '/adminx/foo',
    '/login',
    '/',
    '',
    '/admin/../evil',
    '/admin/%2e%2e/evil',
    '/admin\n/x',
    '/admin\t',
    'admin/certificates',
    `/admin/${'a'.repeat(3000)}`,
  ])('rejects %j', (input) => {
    expect(safeAdminPath(input)).toBeNull();
  });

  it('rejects non-strings', () => {
    for (const value of [undefined, null, 42, {}, ['/admin']]) {
      expect(safeAdminPath(value)).toBeNull();
    }
  });
});

describe('loginTarget', () => {
  it('prefers router state, then ?next=, then /admin', () => {
    expect(loginTarget({ from: '/admin/events' }, '?next=/admin/templates')).toBe('/admin/events');
    expect(loginTarget(null, '?next=/admin/templates')).toBe('/admin/templates');
    expect(loginTarget(undefined, '')).toBe('/admin');
  });

  it('ignores an open-redirect attempt in state or query', () => {
    expect(loginTarget({ from: 'https://evil.test' }, '')).toBe('/admin');
    expect(loginTarget(null, '?next=https://evil.test')).toBe('/admin');
    expect(loginTarget({ from: '//evil.test' }, '?next=//evil.test')).toBe('/admin');
  });
});

describe('loginReason', () => {
  it('accepts only known reasons', () => {
    expect(loginReason({ reason: 'expired' })).toBe('expired');
    expect(loginReason({ reason: 'noAccess' })).toBe('noAccess');
    expect(loginReason({ reason: 'x' })).toBeUndefined();
    expect(loginReason(null)).toBeUndefined();
  });
});
