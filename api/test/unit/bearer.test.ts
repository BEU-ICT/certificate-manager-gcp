import { describe, expect, it } from 'vitest';
import { MAX_BEARER_TOKEN_LENGTH, parseBearerToken } from '../../src/http/auth/bearer.js';
import { UnauthenticatedError } from '../../src/shared/errors.js';

describe('parseBearerToken', () => {
  it('returns the token of a Bearer header', () => {
    expect(parseBearerToken('Bearer abc.def.ghi')).toBe('abc.def.ghi');
  });

  it.each([
    undefined,
    '',
    'Bearer',
    'Bearer ',
    'bearer abc',
    'Basic abc',
    'Bearer a b',
    'Bearer a, Bearer b',
    ['Bearer a', 'Bearer b'],
    `Bearer ${'x'.repeat(MAX_BEARER_TOKEN_LENGTH + 1)}`,
  ])('rejects %j', (header) => {
    expect(() => parseBearerToken(header)).toThrow(UnauthenticatedError);
  });
});
