import { sendEmailTaskSchema } from '../../shared/email-task.js';
import {
  LAST_RETRY_COUNT,
  type SendEmailRequest,
  type SendEmailOutcome,
} from './send-email-handler.js';

/** Thrown to make the in-process queue retry; carries no data. */
export class SendEmailRetryError extends Error {
  override readonly name = 'SendEmailRetryError';
}

/**
 * Adapts the send-email handler to the in-process queue (`QUEUE_ADAPTER=in-process`), where a
 * thrown error means "retry later" and there is no `X-CloudTasks-TaskRetryCount` header. The
 * retry count is kept here per task (certificate and sequence), which matches the queue's own
 * counter because the queue retries each task up to 5 times. An invalid payload is dropped
 * (retrying cannot fix it). State is lost on restart, like the queue itself.
 */
export function createInProcessSendEmailTask(
  handle: (request: SendEmailRequest) => Promise<SendEmailOutcome>,
): (payload: unknown) => Promise<void> {
  const retries = new Map<string, number>();
  return async (payload) => {
    const parsed = sendEmailTaskSchema.safeParse(payload);
    if (!parsed.success) return;
    const { certificateId, sequence } = parsed.data;
    const key = `${certificateId}:${sequence}`;
    const retryCount = retries.get(key) ?? 0;
    const outcome = await handle({ certificateId, sequence, retryCount });
    if (outcome === 'done') {
      retries.delete(key);
      return;
    }
    // Do not grow without bound: the last attempt never reaches here with `retry`.
    if (retryCount < LAST_RETRY_COUNT) retries.set(key, retryCount + 1);
    throw new SendEmailRetryError();
  };
}
