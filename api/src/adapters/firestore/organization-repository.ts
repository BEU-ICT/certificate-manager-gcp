import { FieldPath, Timestamp, type Firestore } from 'firebase-admin/firestore';
import type { OrganizationRepository, Page, PageRequest } from '../../ports/index.js';
import { decodeCursor, encodeCursor, pageLimit } from '../../shared/cursor.js';
import type { Organization } from '../../shared/domain.js';
import { ConflictError, SlugTakenError } from '../../shared/errors.js';
import type { OrganizationId } from '../../shared/ids.js';
import { SCHEMA_VERSION } from '../../shared/schema-version.js';

export const ORGANIZATIONS_COLLECTION = 'organizations';
export const UNIQUES_COLLECTION = 'uniques';
/** Firestore `getAll` and transaction reads are cheap in batches; the limit keeps them bounded. */
const GET_MANY_LIMIT = 100;

/** Reservation document id (`organization-slug:<slug>`), see "Unique keys" in issue #16 §5. */
export const organizationSlugKey = (slug: string): string => `organization-slug:${slug}`;

interface OrganizationDocument {
  name: string;
  slug: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  schemaVersion?: number;
}

function toOrganization(id: string, data: OrganizationDocument): Organization {
  return {
    id: id as OrganizationId,
    name: data.name,
    slug: data.slug,
    createdAt: data.createdAt.toDate(),
    updatedAt: data.updatedAt.toDate(),
    schemaVersion: data.schemaVersion ?? SCHEMA_VERSION,
  };
}

/**
 * Firestore implementation of {@link OrganizationRepository}. `create` reads the reservation
 * document and writes organization + reservation in one transaction (1 read, 2 writes), so
 * concurrent creates of one slug yield exactly one winner. `delete` removes both documents in one
 * transaction. Readers ignore unknown fields.
 */
export class FirestoreOrganizationRepository implements OrganizationRepository {
  constructor(private readonly db: Firestore) {}

  private get collection() {
    return this.db.collection(ORGANIZATIONS_COLLECTION);
  }

  private reservation(slug: string) {
    return this.db.collection(UNIQUES_COLLECTION).doc(organizationSlugKey(slug));
  }

  create(organization: Organization): Promise<void> {
    const ref = this.collection.doc(organization.id);
    const reservation = this.reservation(organization.slug);
    return this.db.runTransaction(async (tx) => {
      const [existing, taken] = await Promise.all([tx.get(ref), tx.get(reservation)]);
      if (existing.exists) throw new ConflictError('Organization already exists');
      if (taken.exists) throw new SlugTakenError('Organization');
      const doc: OrganizationDocument = {
        name: organization.name,
        slug: organization.slug,
        createdAt: Timestamp.fromDate(organization.createdAt),
        updatedAt: Timestamp.fromDate(organization.updatedAt),
        schemaVersion: organization.schemaVersion,
      };
      tx.create(ref, doc);
      tx.create(reservation, {
        kind: 'organization-slug',
        entityId: organization.id,
        schemaVersion: SCHEMA_VERSION,
      });
    });
  }

  async getById(id: OrganizationId): Promise<Organization | null> {
    const snap = await this.collection.doc(id).get();
    return snap.exists ? toOrganization(snap.id, snap.data() as OrganizationDocument) : null;
  }

  async getBySlug(slug: string): Promise<Organization | null> {
    const snap = await this.collection.where('slug', '==', slug).limit(1).get();
    const doc = snap.docs[0];
    return doc ? toOrganization(doc.id, doc.data() as OrganizationDocument) : null;
  }

  async getMany(ids: readonly OrganizationId[]): Promise<Organization[]> {
    const unique = [...new Set(ids)].slice(0, GET_MANY_LIMIT);
    if (unique.length === 0) return [];
    const snaps = await this.db.getAll(...unique.map((id) => this.collection.doc(id)));
    return snaps
      .filter((s) => s.exists)
      .map((s) => toOrganization(s.id, s.data() as OrganizationDocument));
  }

  async list(page?: PageRequest): Promise<Page<Organization>> {
    const limit = pageLimit(page);
    let query = this.collection.orderBy('name').orderBy(FieldPath.documentId());
    if (page?.cursor !== undefined) {
      const [name, id] = decodeCursor(page.cursor, 2);
      query = query.startAfter(String(name), String(id));
    }
    const snap = await query.limit(limit + 1).get();
    const docs = snap.docs.slice(0, limit);
    const items = docs.map((d) => toOrganization(d.id, d.data() as OrganizationDocument));
    const last = items.at(-1);
    return {
      items,
      nextCursor: snap.docs.length > limit && last ? encodeCursor([last.name, last.id]) : null,
    };
  }

  updateName(id: OrganizationId, name: string, updatedAt: Date): Promise<Organization | null> {
    const ref = this.collection.doc(id);
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return null;
      const stamp = Timestamp.fromDate(updatedAt);
      tx.update(ref, { name, updatedAt: stamp });
      return toOrganization(id, {
        ...(snap.data() as OrganizationDocument),
        name,
        updatedAt: stamp,
      });
    });
  }

  delete(id: OrganizationId): Promise<boolean> {
    const ref = this.collection.doc(id);
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return false;
      tx.delete(ref);
      tx.delete(this.reservation((snap.data() as OrganizationDocument).slug));
      return true;
    });
  }

  async count(): Promise<number> {
    const snap = await this.collection.count().get();
    return snap.data().count;
  }
}
