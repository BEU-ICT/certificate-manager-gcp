import { describe, expect, it } from 'vitest';
import { emailTaskName, TASK_NAME_MAX_LENGTH } from '../../src/shared/email-task.js';

describe('emailTaskName', () => {
  it('builds email-<id>-<n> for base64url and legacy hex IDs', () => {
    expect(emailTaskName('AbC_-123456789012345xy', 1)).toBe('email-AbC_-123456789012345xy-1');
    expect(emailTaskName('0123456789abcdef0123456789abcdef', 12)).toBe(
      'email-0123456789abcdef0123456789abcdef-12',
    );
  });

  it('uses a distinct name for every resend', () => {
    expect(emailTaskName('a'.repeat(22), 1)).not.toBe(emailTaskName('a'.repeat(22), 2));
  });

  it.each(['has space', 'dot.dot', 'slash/x', 'new\nline', 'ünï', '', 'a:b', '<x>'])(
    'rejects characters outside [A-Za-z0-9_-]: %j',
    (id) => {
      expect(() => emailTaskName(id, 1)).toThrow(RangeError);
    },
  );

  it('rejects names longer than 500 characters and accepts exactly 500', () => {
    const overhead = 'email-'.length + '-1'.length;
    expect(emailTaskName('a'.repeat(TASK_NAME_MAX_LENGTH - overhead), 1)).toHaveLength(500);
    expect(() => emailTaskName('a'.repeat(TASK_NAME_MAX_LENGTH - overhead + 1), 1)).toThrow(
      RangeError,
    );
  });

  it.each([0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])('rejects sequence %s', (n) => {
    expect(() => emailTaskName('a'.repeat(22), n)).toThrow(RangeError);
  });

  it('does not echo the rejected input in the error message', () => {
    expect(() => emailTaskName('secret@example.com', 1)).toThrow(/^(?!.*secret)/);
  });
});
