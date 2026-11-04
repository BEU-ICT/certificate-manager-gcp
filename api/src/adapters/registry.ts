import type { Config } from '../config.js';
import type { EmailSender, StorageGateway } from '../ports/index.js';
import type { AuthPorts, QueuePorts, RepositoryPorts } from '../wiring.js';

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
