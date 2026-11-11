import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../../src/app.js';
import { createFakes, type Fakes } from '../../../src/testing/fakes/create-fakes.js';

export interface IntegrationApp {
  app: FastifyInstance;
  /** Ports the app was built with. */
  ports: Fakes;
  close(): Promise<void>;
}

/**
 * Builds the HTTP app for integration tests.
 *
 * TODO(BEU-ICT/certificate-manager#283 and the Firestore adapter task): no Firestore adapter or
 * Firebase `TokenVerifier` exists yet, so every port is an in-memory fake. Replace
 * `organizations`, `events`, `templates`, `certificates` (and the rate limiter) with the real
 * Firestore adapter pointed at the emulator, and `tokenVerifier` with the Firebase verifier.
 * Storage, task queue and e-mail stay fakes (issue BEU-ICT/certificate-manager#258). Tests do not need to change.
 */
export function buildIntegrationApp(overrides: Partial<Fakes> = {}): IntegrationApp {
  const ports: Fakes = { ...createFakes(), ...overrides };
  const app = buildApp({ ports });
  return { app, ports, close: () => app.close() };
}
