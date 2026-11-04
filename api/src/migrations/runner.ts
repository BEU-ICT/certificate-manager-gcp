import type { MigrationStateStore } from '../ports/index.js';
import type { Ports } from '../wiring.js';
import { migrations as registered } from './registry.js';
import {
  MigrationDeferred,
  type Migration,
  type MigrationContext,
  type MigrationLogger,
  type MigrationSettings,
} from './types.js';

const ID_PATTERN = /^\d{3}-[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** A migration failed or the list is invalid. Startup must stop. */
export class MigrationError extends Error {
  override readonly name = 'MigrationError';

  constructor(
    message: string,
    readonly migrationId?: string,
    options?: { cause: unknown },
  ) {
    super(message, options);
  }
}

export interface RunMigrationsOptions {
  readonly store: MigrationStateStore;
  readonly context: MigrationContext;
  /** Identifies this process in the marker (`by`), e.g. the Cloud Run revision plus a random suffix. */
  readonly instanceId: string;
  /** Defaults to the registered list in `registry.ts`. */
  readonly migrations?: readonly Migration[];
}

export interface MigrationReport {
  /** Ids this process ran successfully. */
  readonly applied: readonly string[];
  /** Ids that were already marked before this run (including ones another instance claimed). */
  readonly skipped: readonly string[];
  /** Ids that reported {@link MigrationDeferred}: not marked, retried on the next start. */
  readonly deferred?: readonly string[];
}

function validate(list: readonly Migration[]): void {
  const seen = new Set<string>();
  let previous = '';
  for (const { id } of list) {
    if (!ID_PATTERN.test(id)) {
      throw new MigrationError(`Invalid migration id "${id}" (expected NNN-kebab-name)`, id);
    }
    if (seen.has(id)) throw new MigrationError(`Duplicate migration id "${id}"`, id);
    if (id <= previous) {
      throw new MigrationError(
        `Migration "${id}" is registered out of order (after "${previous}")`,
        id,
      );
    }
    seen.add(id);
    previous = id;
  }
}

/**
 * Runs pending migrations in id order and stops at the first failure.
 *
 * Steady state costs one marker read (`appliedIds`). A pending migration is claimed with
 * `markApplied` before its body runs; the instance that loses the claim skips it. If the body
 * throws, the claim is released so the next start retries, and a {@link MigrationError} is thrown
 * (the caller exits non-zero so Cloud Run restarts the instance). Migrations must be idempotent:
 * a crash between claim and release would leave a marker without a finished migration.
 */
export async function runMigrations(options: RunMigrationsOptions): Promise<MigrationReport> {
  const { store, context, instanceId } = options;
  const log = context.log;
  const list = options.migrations ?? registered;
  validate(list);

  const done = await store.appliedIds();
  const applied: string[] = [];
  const skipped: string[] = [];
  const deferred: string[] = [];

  for (const migration of list) {
    const { id } = migration;
    if (done.has(id)) {
      skipped.push(id);
      continue;
    }
    if (!(await store.markApplied(id, instanceId))) {
      log.info({ migration: id }, 'migration claimed by another instance, skipping');
      skipped.push(id);
      continue;
    }
    log.info({ migration: id, description: migration.description }, 'migration started');
    try {
      await migration.run(context);
    } catch (cause) {
      if (cause instanceof MigrationDeferred) {
        await store.unmarkApplied(id, instanceId);
        log.warn({ migration: id, reason: cause.message }, 'migration deferred');
        deferred.push(id);
        continue;
      }
      log.error({ migration: id, err: cause }, 'migration failed');
      try {
        await store.unmarkApplied(id, instanceId);
      } catch (releaseError) {
        log.error({ migration: id, err: releaseError }, 'could not release migration marker');
      }
      throw new MigrationError(`Migration ${id} failed`, id, { cause });
    }
    log.info({ migration: id }, 'migration applied');
    applied.push(id);
  }

  if (applied.length === 0) log.info({ skipped: skipped.length }, 'no pending migrations');
  return deferred.length > 0 ? { applied, skipped, deferred } : { applied, skipped };
}

/** Runs the registered migrations with the composed ports (shared by `server.ts` and `migrate.ts`). */
export function runMigrationsWithPorts(
  ports: Ports,
  log: MigrationLogger,
  instanceId: string,
  settings: MigrationSettings,
): Promise<MigrationReport> {
  return runMigrations({
    store: ports.migrationState,
    instanceId,
    context: {
      clock: ports.clock,
      organizations: ports.organizations,
      events: ports.events,
      templates: ports.templates,
      certificates: ports.certificates,
      emailSender: ports.emailSender,
      adminUsers: ports.adminUsers,
      settings,
      log,
    },
  });
}
