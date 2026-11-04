import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll } from 'vitest';

/** Shared MSW server. Call `setupMswServer()` in a test file, then `server.use(...)` per test. */
export const server = setupServer();

export function setupMswServer(): void {
  beforeAll(() => {
    server.listen({ onUnhandledFrame: 'error' });
  });
  afterEach(() => {
    server.resetHandlers();
  });
  afterAll(() => {
    server.close();
  });
}
