import { FieldPath, Timestamp, type Firestore, type Query } from 'firebase-admin/firestore';
import type { Page, PageRequest, TemplateFilter, TemplateRepository } from '../../ports/index.js';
import type { CertificateType } from '../../shared/certificate-types.js';
import { decodeCursor, encodeCursor, pageLimit } from '../../shared/cursor.js';
import type { Template } from '../../shared/domain.js';
import { ConflictError } from '../../shared/errors.js';
import type { EventId, OrganizationId, TemplateRef } from '../../shared/ids.js';
import { SCHEMA_VERSION } from '../../shared/schema-version.js';

export const TEMPLATES_COLLECTION = 'templates';

/** gRPC status `ALREADY_EXISTS`, what `DocumentReference.create()` rejects with. */
const ALREADY_EXISTS = 6;

interface TemplateDocument {
  organizationId: string;
  eventId: string;
  organizationSlug: string;
  eventSlug: string;
  type: string;
  version: number;
  storagePath: string;
  config: Record<string, unknown>;
  createdAt: Timestamp;
  createdBy: string;
  schemaVersion?: number;
}

function toTemplate(reference: string, data: TemplateDocument): Template {
  return {
    reference: reference as TemplateRef,
    organizationId: data.organizationId as OrganizationId,
    eventId: data.eventId as EventId,
    organizationSlug: data.organizationSlug,
    eventSlug: data.eventSlug,
    type: data.type as CertificateType,
    version: data.version,
    storagePath: data.storagePath,
    config: data.config,
    createdAt: data.createdAt.toDate(),
    createdBy: data.createdBy,
    schemaVersion: data.schemaVersion ?? SCHEMA_VERSION,
  };
}

/**
 * Firestore implementation of {@link TemplateRepository}. The document id is the template
 * reference, so uniqueness is Firestore's own `create()` semantics (no reservation document).
 * Queries need the composite index `organizationId, eventId, type, version desc` (latest version)
 * and `<field>, createdAt desc` for each of organizationId / eventId / type (filtered lists);
 * see infra/firestore.indexes.json.
 */
export class FirestoreTemplateRepository implements TemplateRepository {
  constructor(private readonly db: Firestore) {}

  private get collection() {
    return this.db.collection(TEMPLATES_COLLECTION);
  }

  async create(template: Template): Promise<void> {
    const doc: TemplateDocument = {
      organizationId: template.organizationId,
      eventId: template.eventId,
      organizationSlug: template.organizationSlug,
      eventSlug: template.eventSlug,
      type: template.type,
      version: template.version,
      storagePath: template.storagePath,
      // Firestore rejects `undefined`; the config is plain JSON, so a round trip drops them.
      config: JSON.parse(JSON.stringify(template.config)) as Record<string, unknown>,
      createdAt: Timestamp.fromDate(template.createdAt),
      createdBy: template.createdBy,
      schemaVersion: template.schemaVersion,
    };
    try {
      await this.collection.doc(template.reference).create(doc);
    } catch (error) {
      if ((error as { code?: unknown }).code === ALREADY_EXISTS) {
        throw new ConflictError('Template reference already exists');
      }
      throw error;
    }
  }

  async getByReference(reference: TemplateRef): Promise<Template | null> {
    const snap = await this.collection.doc(reference).get();
    return snap.exists ? toTemplate(snap.id, snap.data() as TemplateDocument) : null;
  }

  async getLatest(
    organizationId: OrganizationId,
    eventId: EventId,
    type: string,
  ): Promise<Template | null> {
    const snap = await this.collection
      .where('organizationId', '==', organizationId)
      .where('eventId', '==', eventId)
      .where('type', '==', type)
      .orderBy('version', 'desc')
      .limit(1)
      .get();
    const doc = snap.docs[0];
    return doc ? toTemplate(doc.id, doc.data() as TemplateDocument) : null;
  }

  async maxVersion(
    organizationId: OrganizationId,
    eventId: EventId,
    type: string,
  ): Promise<number | null> {
    const snap = await this.collection
      .where('organizationId', '==', organizationId)
      .where('eventId', '==', eventId)
      .where('type', '==', type)
      .orderBy('version', 'desc')
      .select('version')
      .limit(1)
      .get();
    const doc = snap.docs[0];
    return doc ? (doc.data() as { version: number }).version : null;
  }

  async list(filter: TemplateFilter = {}, page?: PageRequest): Promise<Page<Template>> {
    const limit = pageLimit(page);
    let query = this.filtered(filter)
      .orderBy('createdAt', 'desc')
      .orderBy(FieldPath.documentId(), 'desc');
    if (page?.cursor !== undefined) {
      const [millis, id] = decodeCursor(page.cursor, 2);
      query = query.startAfter(Timestamp.fromMillis(Number(millis)), String(id));
    }
    const snap = await query.limit(limit + 1).get();
    const items = snap.docs
      .slice(0, limit)
      .map((d) => toTemplate(d.id, d.data() as TemplateDocument));
    const last = items.at(-1);
    return {
      items,
      nextCursor:
        snap.docs.length > limit && last
          ? encodeCursor([last.createdAt.getTime(), last.reference])
          : null,
    };
  }

  async count(filter: TemplateFilter = {}): Promise<number> {
    return (await this.filtered(filter).count().get()).data().count;
  }

  private filtered(filter: TemplateFilter): Query {
    let query: Query = this.collection;
    if (filter.organizationId !== undefined) {
      query = query.where('organizationId', '==', filter.organizationId);
    }
    if (filter.eventId !== undefined) query = query.where('eventId', '==', filter.eventId);
    if (filter.type !== undefined) query = query.where('type', '==', filter.type);
    return query;
  }
}
