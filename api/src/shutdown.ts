import type { FastifyInstance } from 'fastify';

export const SHUTDOWN_GRACE_MS = 8_000;

/**
 * Stops accepting connections, lets in-flight requests finish (at most
 * `graceMs`), then runs `closeAdapters`. Returns true when everything closed
 * cleanly within the grace period.
 */
export async function shutdown(
  app: FastifyInstance,
  closeAdapters: () => Promise<void> = async () => {},
  graceMs: number = SHUTDOWN_GRACE_MS,
): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => {
      app.server.closeAllConnections();
      resolve(false);
    }, graceMs);
  });
  const graceful = app.close().then(() => true as const);
  const clean = await Promise.race([graceful, timeout]);
  clearTimeout(timer);
  await closeAdapters();
  return clean;
}
