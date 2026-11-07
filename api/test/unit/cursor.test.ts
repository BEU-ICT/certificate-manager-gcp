import { describe, expect, it } from 'vitest';
import {
  decodeIssuedAtCursor,
  encodeCursor,
  encodeIssuedAtCursor,
} from '../../src/shared/cursor.js';
import { ValidationError } from '../../src/shared/errors.js';

const ID = 'AAAAAAAAAAAAAAAAAAAAAA';

describe('issuedAt cursor', () => {
  it('round-trips', () => {
    const at = new Date(Date.UTC(2026, 0, 1));
    expect(decodeIssuedAtCursor(encodeIssuedAtCursor(at, ID))).toEqual({
      issuedAtMillis: at.getTime(),
      id: ID,
    });
  });

  it.each([
    [[1e20, 'x']],
    [[1, 'a/b']],
    [[1, '']],
    [[1.5, ID]],
    [[253_402_300_800_000, ID]],
    [[-62_135_596_800_001, ID]],
    [[1]],
    [['1', ID]],
  ])('rejects tampered %j', (values) => {
    expect(() => decodeIssuedAtCursor(encodeCursor(values))).toThrow(ValidationError);
  });

  it('rejects garbage', () => {
    expect(() => decodeIssuedAtCursor('%%%')).toThrow(ValidationError);
  });
});
