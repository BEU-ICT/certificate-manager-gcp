import type { DomainEvents, DomainEventType, EventBus, EventHandler } from '../../ports/index.js';

interface Subscriber {
  name: string;
  handler: EventHandler<DomainEventType>;
}

/**
 * Simple in-memory bus that records everything published. Subscribers run
 * sequentially in registration order; a failing one is recorded in `errors`
 * and never makes `publish` reject.
 */
export class FakeEventBus implements EventBus {
  readonly published: { type: DomainEventType; payload: DomainEvents[DomainEventType] }[] = [];
  readonly errors: { type: DomainEventType; subscriber: string; error: unknown }[] = [];
  private readonly subscribers = new Map<DomainEventType, Subscriber[]>();

  async publish<T extends DomainEventType>(type: T, payload: DomainEvents[T]): Promise<void> {
    this.published.push({ type, payload: structuredClone(payload) });
    for (const { name, handler } of [...(this.subscribers.get(type) ?? [])]) {
      try {
        await handler(payload);
      } catch (error) {
        this.errors.push({ type, subscriber: name, error });
      }
    }
  }

  subscribe<T extends DomainEventType>(
    type: T,
    name: string,
    handler: EventHandler<T>,
  ): () => void {
    const entry: Subscriber = { name, handler: handler as EventHandler<DomainEventType> };
    this.subscribers.set(type, [...(this.subscribers.get(type) ?? []), entry]);
    return () => {
      this.subscribers.set(
        type,
        (this.subscribers.get(type) ?? []).filter((s) => s !== entry),
      );
    };
  }
}
