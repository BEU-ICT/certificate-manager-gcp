// Preload for tests that spawn src/server.ts: registers inert stubs for the local-profile
// adapters until the real in-memory adapters exist (tasks #33 / #36); then this file can go.
import { builtinRegistrations } from '../../src/compose.js';

const inert = <T>(): T => ({}) as T;

builtinRegistrations.push((r) => {
  r.db.register('memory', () => inert());
  r.storage.register('memory', () => inert());
  r.queue.register('in-process', () => inert());
  r.auth.register('firebase', () => inert());
  r.email.register('gmail', () => inert());
});
