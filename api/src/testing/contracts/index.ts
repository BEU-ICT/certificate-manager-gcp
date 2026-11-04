/**
 * Port contract suites: the executable specification of every port in `src/ports`.
 * Each adapter (fake or real) calls the matching `describe<Port>Contract` from a
 * `*.contract.test.ts` file. See "Adding an adapter" in api/README.md.
 */
export { clause, withAdapter, type AdapterHandle, type ContractFactory } from './types.js';
export { describeStorageGatewayContract } from './storage-gateway.js';
export {
  describeTaskQueueContract,
  type PendingTask,
  type TaskQueueContractFactory,
  type TaskQueueHandle,
} from './task-queue.js';
export { describeEventBusContract } from './event-bus.js';
export {
  describeRateLimiterContract,
  type RateLimiterContractFactory,
  type RateLimiterHandle,
} from './rate-limiter.js';
export { describeClockContract, describeIdGeneratorContract } from './clock.js';
export {
  describeMigrationStateStoreContract,
  type MigrationStateStoreContractFactory,
} from './migration-state-store.js';
export {
  describeTokenVerifierContract,
  type TokenVerifierContractFactory,
  type TokenVerifierHandle,
} from './token-verifier.js';
export {
  describeOrganizationRepositoryContract,
  sampleOrganization,
  type OrganizationRepositoryContractFactory,
} from './organization-repository.js';
export {
  describeEventRepositoryContract,
  sampleEvent,
  ORG_A,
  ORG_B,
  type EventRepositoryContractFactory,
} from './event-repository.js';
