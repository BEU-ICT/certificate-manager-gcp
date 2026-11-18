/** Executes one task; throwing means "retry later". Must be idempotent (at-least-once). */
/** `retryCount`: failed attempts so far (0 on the first), when the queue counts them itself. */
export type TaskHandlerFn = (payload: unknown, info?: { retryCount: number }) => Promise<void>;

/** Handler path (as in `TaskRequest.handler`) to function. */
export type TaskHandlerRegistry = Map<string, TaskHandlerFn>;

/**
 * Handlers that `QUEUE_ADAPTER=in-process` runs in the same process, without HTTP or OIDC.
 * The send-email handler is added here by BEU-ICT/certificate-manager#368, keyed by
 * `SEND_EMAIL_HANDLER` (src/shared/email-task.ts), so Cloud Tasks and in-process share one path.
 */
export const inProcessTaskHandlers: TaskHandlerRegistry = new Map();
