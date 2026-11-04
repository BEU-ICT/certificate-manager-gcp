import type { EventRepository, Page, PageRequest } from '../../ports/index.js';
import { decodeCursor, encodeCursor, pageLimit } from '../../shared/cursor.js';
import type { CertificateEvent, EmailLanguage } from '../../shared/domain.js';
import { ConflictError, SlugTakenError } from '../../shared/errors.js';
import type { EventId, OrganizationId } from '../../shared/ids.js';

const slugKey = (organizationId: string, slug: string) => `${organizationId}:${slug}`;

/** In-memory repository; `bySlug` plays the role of the reservation documents. */
export class FakeEventRepository implements EventRepository {
  private readonly byId = new Map<string, CertificateEvent>();
  private readonly bySlug = new Map<string, string>();

  create(event: CertificateEvent): Promise<void> {
    if (this.byId.has(event.id)) return Promise.reject(new ConflictError('Event already exists'));
    const key = slugKey(event.organizationId, event.slug);
    if (this.bySlug.has(key)) return Promise.reject(new SlugTakenError('Event'));
    this.byId.set(event.id, structuredClone(event));
    this.bySlug.set(key, event.id);
    return Promise.resolve();
  }

  getById(id: EventId): Promise<CertificateEvent | null> {
    const found = this.byId.get(id);
    return Promise.resolve(found ? structuredClone(found) : null);
  }

  getBySlug(organizationId: OrganizationId, slug: string): Promise<CertificateEvent | null> {
    const id = this.bySlug.get(slugKey(organizationId, slug));
    return this.getById(id as EventId);
  }

  list(
    filter: { organizationId?: OrganizationId } = {},
    page?: PageRequest,
  ): Promise<Page<CertificateEvent>> {
    return Promise.resolve().then(() => {
      const limit = pageLimit(page);
      const after = page?.cursor === undefined ? null : decodeCursor(page.cursor, 2);
      const newestFirst = (a: CertificateEvent, b: CertificateEvent) =>
        b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
      const rest = [...this.byId.values()]
        .filter(
          (e) => filter.organizationId === undefined || e.organizationId === filter.organizationId,
        )
        .sort(newestFirst)
        .filter(
          (e) =>
            after === null ||
            e.createdAt.getTime() < Number(after[0]) ||
            (e.createdAt.getTime() === Number(after[0]) && e.id < String(after[1])),
        );
      const items = rest.slice(0, limit);
      const last = items.at(-1);
      return {
        items: items.map((e) => structuredClone(e)),
        nextCursor:
          rest.length > limit && last ? encodeCursor([last.createdAt.getTime(), last.id]) : null,
      };
    });
  }

  update(
    id: EventId,
    changes: { name?: string; emailLanguage?: EmailLanguage },
    updatedAt: Date,
  ): Promise<CertificateEvent | null> {
    const found = this.byId.get(id);
    if (!found) return Promise.resolve(null);
    const updated: CertificateEvent = {
      ...found,
      ...(changes.name !== undefined && { name: changes.name }),
      ...(changes.emailLanguage !== undefined && { emailLanguage: changes.emailLanguage }),
      updatedAt,
    };
    this.byId.set(id, updated);
    return Promise.resolve(structuredClone(updated));
  }

  delete(id: EventId): Promise<boolean> {
    const found = this.byId.get(id);
    if (!found) return Promise.resolve(false);
    this.byId.delete(id);
    this.bySlug.delete(slugKey(found.organizationId, found.slug));
    return Promise.resolve(true);
  }

  count(organizationId?: OrganizationId): Promise<number> {
    if (organizationId === undefined) return Promise.resolve(this.byId.size);
    return Promise.resolve(
      [...this.byId.values()].filter((e) => e.organizationId === organizationId).length,
    );
  }
}
