import type {
  DomainEventType,
  DomainEvents,
  EventBus,
  EventHandler,
} from '../../ports/event-bus.js';

/**
 * In-process `EventBus`. Subscribers are registered in the composition root
 * (`src/compose.ts`), never in publisher modules, so adding a subscriber needs
 * no change to publisher code.
 */

/** Minimal logger surface; satisfied by pino and the Fastify logger. */
export interface EventBusLogger {
  error(obj: Record<string, unknown>, msg: string): void;
}

interface Subscription {
  readonly name: string;
  readonly handler: (payload: never) => Promise<void> | void;
  active: boolean;
}

export class InProcessEventBus implements EventBus {
  private readonly subscriptions = new Map<DomainEventType, Subscription[]>();

  constructor(private readonly logger: EventBusLogger) {}

  async publish<T extends DomainEventType>(type: T, payload: DomainEvents[T]): Promise<void> {
    // Snapshot: subscribers added during this publish do not get the in-flight event.
    const snapshot = [...(this.subscriptions.get(type) ?? [])];
    for (const subscription of snapshot) {
      // Skip handlers unsubscribed while this publish was running.
      if (!subscription.active) continue;
      try {
        await (subscription.handler as EventHandler<T>)(payload);
      } catch (err) {
        // Never log the payload; only the error message and stack.
        this.logger.error(
          {
            eventType: type,
            subscriber: subscription.name,
            err: err instanceof Error ? { message: err.message, stack: err.stack } : String(err),
          },
          'event subscriber failed',
        );
      }
    }
  }

  subscribe<T extends DomainEventType>(
    type: T,
    name: string,
    handler: EventHandler<T>,
  ): () => void {
    const subscription: Subscription = { name, handler, active: true };
    const list = this.subscriptions.get(type) ?? [];
    this.subscriptions.set(type, [...list, subscription]);
    return () => {
      subscription.active = false;
      const current = this.subscriptions.get(type) ?? [];
      this.subscriptions.set(
        type,
        current.filter((s) => s !== subscription),
      );
    };
  }
}
