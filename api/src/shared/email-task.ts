import { z } from 'zod';

/**
 * Naming of e-mail queue tasks (BEU-ICT/certificate-manager#366). Cloud Tasks accepts task IDs of
 * letters, digits, `-` and `_` up to 500 characters and refuses a name that was used within roughly
 * the last hour, so every send and every resend needs its own `n`.
 */

export const TASK_NAME_PATTERN = /^[A-Za-z0-9_-]+$/;
export const TASK_NAME_MAX_LENGTH = 500;
/** Internal route that executes an e-mail task. */
export const SEND_EMAIL_HANDLER = '/internal/tasks/send-email';

/** Payload of an e-mail task: identifiers only, never addresses or names. */
export interface SendEmailTaskPayload {
  certificateId: string;
  sequence: number;
}

/** Throws `RangeError` when `name` cannot be a Cloud Tasks task ID. */
export function assertValidTaskName(name: string): void {
  if (name.length === 0 || name.length > TASK_NAME_MAX_LENGTH || !TASK_NAME_PATTERN.test(name)) {
    throw new RangeError(
      `invalid task name: must match ${TASK_NAME_PATTERN.source} and be 1..${TASK_NAME_MAX_LENGTH} characters`,
    );
  }
}

/**
 * `email-<certificateId>-<n>`, where `n` is `emailAttempts` after the increment (first send: 1).
 * Throws `RangeError` for an invalid certificate ID or sequence; the message never echoes input.
 */
export function emailTaskName(certificateId: string, n: number): string {
  if (!Number.isSafeInteger(n) || n < 1)
    throw new RangeError('sequence must be a positive integer');
  if (certificateId.length === 0) throw new RangeError('certificate ID must not be empty');
  const name = `email-${certificateId}-${n}`;
  assertValidTaskName(name);
  return name;
}

/** Strict body of the send-email task: unknown properties are rejected (400). */
export const sendEmailTaskSchema = z
  .object({
    certificateId: z.string().min(1).max(64),
    sequence: z.number().int().min(1).max(1_000_000),
  })
  .strict();
