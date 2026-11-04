import { FieldPath, Timestamp, type Firestore, type Query } from 'firebase-admin/firestore';
import type { EventRepository, Page, PageRequest } from '../../ports/index.js';
import { decodeCursor, encodeCursor, pageLimit } from '../../shared/cursor.js';
import {
  DEFAULT_EMAIL_LANGUAGE,
  type CertificateEvent,
  type EmailLanguage,
} from '../../shared/domain.js';
import { ConflictError, SlugTakenError } from '../../shared/errors.js';
import type { EventId, OrganizationId } from '../../shared/ids.js';
import { SCHEMA_VERSION } from '../../shared/schema-version.js';
import { UNIQUES_COLLECTION } from './organization-repository.js';

export const EVENTS_COLLECTION = 'events';

/** Reservation document id (`event-slug:<orgId>:<slug>`), see "Unique keys" in issue #16 §5. */
export const eventSlugKey = (organizationId: string, slug: string): string =>
  `event-slug:${organizationId}:${slug}`;

interface EventDocument {
  organizationId: string;
  name: string;
  slug: string;
  emailLanguage?: EmailLanguage;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  schemaVersion?: number;
}

function toEvent(id: string, data: EventDocument): CertificateEvent {
  return {
    id: id as EventId,
    organizationId: data.organizationId as OrganizationId,
    name: data.name,
    slug: data.slug,
    emailLanguage: data.emailLanguage ?? DEFAULT_EMAIL_LANGUAGE,
    createdAt: data.createdAt.toDate(),
    updatedAt: data.updatedAt.toDate(),
    schemaVersion: data.schemaVersion ?? SCHEMA_VERSION,
  };
}

/**
 * Firestore implementation of {@link EventRepository}. Create and delete keep the reservation
 * document `uniques/event-slug:<orgId>:<slug>` in step with the event in one transaction.
 * Lists need the composite index `organizationId asc, createdAt desc` (infra/firestore.indexes.json).
 */
export class FirestoreEventRepository implements EventRepository {
  constructor(private readonly db: Firestore) {}

  private get collection() {
    return this.db.collection(EVENTS_COLLECTION);
  }

  private reservation(organizationId: string, slug: string) {
    return this.db.collection(UNIQUES_COLLECTION).doc(eventSlugKey(organizationId, slug));
  }

  create(event: CertificateEvent): Promise<void> {
    const ref = this.collection.doc(event.id);
    const reservation = this.reservation(event.organizationId, event.slug);
    return this.db.runTransaction(async (tx) => {
      const [existing, taken] = await Promise.all([tx.get(ref), tx.get(reservation)]);
      if (existing.exists) throw new ConflictError('Event already exists');
      if (taken.exists) throw new SlugTakenError('Event');
      const doc: EventDocument = {
        organizationId: event.organizationId,
        name: event.name,
        slug: event.slug,
        emailLanguage: event.emailLanguage,
        createdAt: Timestamp.fromDate(event.createdAt),
        updatedAt: Timestamp.fromDate(event.updatedAt),
        schemaVersion: event.schemaVersion,
      };
      tx.create(ref, doc);
      tx.create(reservation, {
        kind: 'event-slug',
        entityId: event.id,
        schemaVersion: SCHEMA_VERSION,
      });
    });
  }

  async getById(id: EventId): Promise<CertificateEvent | null> {
    const snap = await this.collection.doc(id).get();
    return snap.exists ? toEvent(snap.id, snap.data() as EventDocument) : null;
  }

  async getBySlug(organizationId: OrganizationId, slug: string): Promise<CertificateEvent | null> {
    const reservation = await this.reservation(organizationId, slug).get();
    if (!reservation.exists) return null;
    return this.getById((reservation.data() as { entityId: string }).entityId as EventId);
  }

  async list(
    filter: { organizationId?: OrganizationId } = {},
    page?: PageRequest,
  ): Promise<Page<CertificateEvent>> {
    const limit = pageLimit(page);
    let query: Query = this.collection;
    if (filter.organizationId !== undefined) {
      query = query.where('organizationId', '==', filter.organizationId);
    }
    query = query.orderBy('createdAt', 'desc').orderBy(FieldPath.documentId(), 'desc');
    if (page?.cursor !== undefined) {
      const [millis, id] = decodeCursor(page.cursor, 2);
      query = query.startAfter(Timestamp.fromMillis(Number(millis)), String(id));
    }
    const snap = await query.limit(limit + 1).get();
    const items = snap.docs.slice(0, limit).map((d) => toEvent(d.id, d.data() as EventDocument));
    const last = items.at(-1);
    return {
      items,
      nextCursor:
        snap.docs.length > limit && last ? encodeCursor([last.createdAt.getTime(), last.id]) : null,
    };
  }

  update(
    id: EventId,
    changes: { name?: string; emailLanguage?: EmailLanguage },
    updatedAt: Date,
  ): Promise<CertificateEvent | null> {
    const ref = this.collection.doc(id);
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return null;
      const patch = {
        ...(changes.name !== undefined && { name: changes.name }),
        ...(changes.emailLanguage !== undefined && { emailLanguage: changes.emailLanguage }),
        updatedAt: Timestamp.fromDate(updatedAt),
      };
      tx.update(ref, patch);
      return toEvent(id, { ...(snap.data() as EventDocument), ...patch });
    });
  }

  delete(id: EventId): Promise<boolean> {
    const ref = this.collection.doc(id);
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return false;
      const data = snap.data() as EventDocument;
      tx.delete(ref);
      tx.delete(this.reservation(data.organizationId, data.slug));
      return true;
    });
  }

  async count(organizationId?: OrganizationId): Promise<number> {
    const base: Query = this.collection;
    const query =
      organizationId === undefined ? base : base.where('organizationId', '==', organizationId);
    return (await query.count().get()).data().count;
  }
}
