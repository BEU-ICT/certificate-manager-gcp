import { describe, expect, it } from 'vitest';
import { maskEmail } from './maskEmail';

describe('maskEmail', () => {
  it('keeps the first characters and the last domain label', () => {
    expect(maskEmail('aysel@domain.com')).toBe('a***@d***.com');
    expect(maskEmail('a@d.co')).toBe('a***@d***.co');
    expect(maskEmail('x@mail.example.org')).toBe('x***@m***.org');
  });

  it('handles a domain without a dot and malformed input', () => {
    expect(maskEmail('a@localhost')).toBe('a***@l***');
    expect(maskEmail('not-an-address')).toBe('***');
  });
});
