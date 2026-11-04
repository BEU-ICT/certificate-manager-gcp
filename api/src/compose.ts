import {
  AUTH_PROVIDERS,
  DB_ADAPTERS,
  EMAIL_PROVIDERS,
  QUEUE_ADAPTERS,
  STORAGE_ADAPTERS,
  type Config,
} from './config.js';
import { InProcessEventBus } from './adapters/in-process/event-bus.js';
import { InProcessRateLimiter } from './adapters/in-process/rate-limiter.js';
import { RandomIdGenerator } from './adapters/system/id-generator.js';
import { registerMemoryAdapters } from './adapters/memory/index.js';
import { SystemClock } from './adapters/system/clock.js';
import { createLogger } from './http/logging/logger.js';
import type { EmailSender, StorageGateway } from './ports/index.js';
import type { AuthPorts, Ports, QueuePorts, RepositoryPorts, Services } from './wiring.js';

/**
 * Composition root: the only place that knows which adapter implements which port.
 * No module imports this file. Adapter factories are lazy: a factory `import()`s its adapter
 * module (and heavy vendor SDK) only when that adapter is selected.
 */

/** Boot-time wiring failure (unknown or unavailable adapter). The message is safe to print. */
export class AdapterError extends Error {
  override readonly name = 'AdapterError';
}

export interface AdapterContext {
  readonly config: Config;
}

export type AdapterFactory<P> = (ctx: AdapterContext) => P | Promise<P>;

/** Adapters of one port, registered by name. `allowed` is the closed set of names config accepts. */
export class AdapterRegistry<P> {
  private readonly factories = new Map<string, AdapterFactory<P>>();

  constructor(
    /** Selector name for messages, e.g. `DB_ADAPTER`. */
    readonly selector: string,
    readonly allowed: readonly string[],
  ) {}

  /** Registers (or replaces) the factory for `name`. Fails when `name` is not an allowed name. */
  register(name: string, factory: AdapterFactory<P>): this {
    if (!this.allowed.includes(name)) throw new AdapterError(this.unknownMessage(name));
    this.factories.set(name, factory);
    return this;
  }

  /** Names that currently have an implementation. */
  registered(): string[] {
    return [...this.factories.keys()];
  }

  has(name: string): boolean {
    return this.factories.has(name);
  }

  async resolve(name: string, ctx: AdapterContext): Promise<P> {
    const factory = this.factories.get(name);
    if (factory) return factory(ctx);
    if (this.allowed.includes(name)) {
      throw new AdapterError(
        `${this.selector}: adapter "${name}" is not available in this build ` +
          `(available: ${this.registered().join(', ') || 'none'})`,
      );
    }
    throw new AdapterError(this.unknownMessage(name));
  }

  private unknownMessage(name: string): string {
    return `${this.selector}: unknown adapter "${name}" (allowed: ${this.allowed.join(', ')})`;
  }
}

export interface Registries {
  readonly db: AdapterRegistry<RepositoryPorts>;
  readonly storage: AdapterRegistry<StorageGateway>;
  readonly queue: AdapterRegistry<QueuePorts>;
  readonly auth: AdapterRegistry<AuthPorts>;
  readonly email: AdapterRegistry<EmailSender>;
}

/** Registers the adapters that exist in this build. Each adapter task adds an entry below. */
export type AdapterRegistration = (registries: Registries) => void;

/**
 * Built-in registrations, applied by {@link defaultRegistries}. A real adapter adds a lazy
 * factory, e.g. `(r) => r.db.register('firestore', async (ctx) => (await import('./adapters/firestore/index.js')).create(ctx))`.
 * Exported mutable only so that process-level test preloads can add stubs.
 */
export const builtinRegistrations: AdapterRegistration[] = [registerMemoryAdapters];

/** Registries with the names defined by the configuration plus the built-in registrations. */
export function defaultRegistries(): Registries {
  const registries: Registries = {
    db: new AdapterRegistry<RepositoryPorts>('DB_ADAPTER', DB_ADAPTERS),
    storage: new AdapterRegistry<StorageGateway>('STORAGE_ADAPTER', STORAGE_ADAPTERS),
    queue: new AdapterRegistry<QueuePorts>('QUEUE_ADAPTER', QUEUE_ADAPTERS),
    auth: new AdapterRegistry<AuthPorts>('AUTH_PROVIDER', AUTH_PROVIDERS),
    email: new AdapterRegistry<EmailSender>('EMAIL_PROVIDER', EMAIL_PROVIDERS),
  };
  for (const register of builtinRegistrations) register(registries);
  return registries;
}

export type Env = Readonly<Record<string, string | undefined>>;

export interface AdapterSelection {
  readonly db: string;
  readonly storage: string;
  readonly queue: string;
  readonly auth: string;
  readonly email: string;
  readonly emailFallback: string | undefined;
}

/**
 * Chooses adapter names. Config decides; the only addition is the local profile
 * (NODE_ENV=development): when FIRESTORE_EMULATOR_HOST is set and DB_ADAPTER was not given
 * explicitly, Firestore (the emulator) replaces the in-memory default. The Firebase Auth
 * emulator needs no switch because the `firebase` adapter honours FIREBASE_AUTH_EMULATOR_HOST itself.
 */
export function selectAdapters(config: Config, env: Env = {}): AdapterSelection {
  let db: string = config.adapters.db;
  if (config.env === 'development' && env['FIRESTORE_EMULATOR_HOST'] && !env['DB_ADAPTER']) {
    db = 'firestore';
  }
  return {
    db,
    storage: config.adapters.storage,
    queue: config.adapters.queue,
    auth: config.adapters.auth,
    email: config.email.provider,
    emailFallback:
      config.flags.emailFallback && config.email.fallbackProvider
        ? config.email.fallbackProvider
        : undefined,
  };
}

export interface Composition {
  readonly config: Config;
  readonly ports: Ports;
  readonly services: Services;
}

/**
 * Builds module services from ports. Each module adds its service here; the signature gains
 * `(ports: Ports, config: Config)` with the first module service.
 */
export function buildServices(): Services {
  return {};
}

/**
 * Builds every port selected by `config` and constructs the module services.
 * Throws {@link AdapterError} for unknown or unavailable adapters.
 */
export async function compose(
  config: Config,
  registries: Registries = defaultRegistries(),
  env: Env = {},
): Promise<Composition> {
  const ctx: AdapterContext = { config };
  const sel = selectAdapters(config, env);
  const [repositories, storage, queue, auth, email, emailFallback] = await Promise.all([
    registries.db.resolve(sel.db, ctx),
    registries.storage.resolve(sel.storage, ctx),
    registries.queue.resolve(sel.queue, ctx),
    registries.auth.resolve(sel.auth, ctx),
    registries.email.resolve(sel.email, ctx),
    sel.emailFallback === undefined
      ? Promise.resolve(undefined)
      : registries.email.resolve(sel.emailFallback, ctx),
  ]);
  const clock = new SystemClock();
  // Subscribers are registered here, in the composition root, never in publisher modules.
  const eventBus = new InProcessEventBus(
    createLogger({ level: config.logLevel, gcpProject: config.gcpProject }),
  );
  const ports: Ports = {
    clock,
    ids: new RandomIdGenerator(),
    ...repositories,
    storage,
    ...queue,
    ...auth,
    emailSender: email,
    ...(emailFallback ? { emailFallback } : {}),
    rateLimiter: new InProcessRateLimiter(clock),
    eventBus,
  };
  return { config, ports, services: buildServices() };
}
