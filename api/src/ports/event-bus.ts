import type { CertificateId, EventId, OrganizationId } from '../shared/ids.js';

/** Domain events. Payloads carry only IDs and timestamps, never personal data. */
export interface DomainEvents {
  'certificate.issued': {
    certificateId: CertificateId;
    organizationId: OrganizationId;
    eventId: EventId;
    hasEmail: boolean;
    occurredAt: Date;
  };
  'certificate.revoked': {
    certificateId: CertificateId;
    occurredAt: Date;
  };
}

export type DomainEventType = keyof DomainEvents;
export type EventHandler<T extends DomainEventType> = (
  payload: DomainEvents[T],
) => Promise<void> | void;

export interface EventBus {
  /**
   * Resolves after every subscriber ran, in registration order. A failing
   * subscriber is logged and never makes `publish` reject.
   */
  publish<T extends DomainEventType>(type: T, payload: DomainEvents[T]): Promise<void>;
  /** Returns an unsubscribe function. `name` identifies the subscriber in logs. */
  subscribe<T extends DomainEventType>(type: T, name: string, handler: EventHandler<T>): () => void;
}
