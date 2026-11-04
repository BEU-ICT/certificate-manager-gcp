import type { OrganizationRepository, Page, PageRequest } from '../../ports/index.js';
import { decodeCursor, encodeCursor, pageLimit } from '../../shared/cursor.js';
import type { Organization } from '../../shared/domain.js';
import { ConflictError, SlugTakenError } from '../../shared/errors.js';
import type { OrganizationId } from '../../shared/ids.js';

const byteCompare = (a: string, b: string): number =>
  Buffer.compare(Buffer.from(a), Buffer.from(b));

/** In-memory repository; the slug reservation is the `bySlug` index, kept in step with `byId`. */
export class FakeOrganizationRepository implements OrganizationRepository {
  private readonly byId = new Map<string, Organization>();
  private readonly bySlug = new Map<string, string>();

  create(organization: Organization): Promise<void> {
    if (this.byId.has(organization.id)) {
      return Promise.reject(new ConflictError('Organization already exists'));
    }
    if (this.bySlug.has(organization.slug)) {
      return Promise.reject(new SlugTakenError('Organization'));
    }
    this.byId.set(organization.id, structuredClone(organization));
    this.bySlug.set(organization.slug, organization.id);
    return Promise.resolve();
  }

  getById(id: OrganizationId): Promise<Organization | null> {
    const found = this.byId.get(id);
    return Promise.resolve(found ? structuredClone(found) : null);
  }

  getBySlug(slug: string): Promise<Organization | null> {
    const id = this.bySlug.get(slug);
    return this.getById(id as OrganizationId);
  }

  getMany(ids: readonly OrganizationId[]): Promise<Organization[]> {
    const found = ids.flatMap((id) => {
      const item = this.byId.get(id);
      return item ? [structuredClone(item)] : [];
    });
    return Promise.resolve(found);
  }

  list(page?: PageRequest): Promise<Page<Organization>> {
    return Promise.resolve().then(() => {
      const limit = pageLimit(page);
      const after = page?.cursor === undefined ? null : decodeCursor(page.cursor, 2);
      const sorted = [...this.byId.values()].sort(
        (a, b) => byteCompare(a.name, b.name) || byteCompare(a.id, b.id),
      );
      const rest = after
        ? sorted.filter(
            (o) =>
              byteCompare(o.name, String(after[0])) > 0 ||
              (o.name === after[0] && byteCompare(o.id, String(after[1])) > 0),
          )
        : sorted;
      const items = rest.slice(0, limit);
      const last = items.at(-1);
      return {
        items: items.map((o) => structuredClone(o)),
        nextCursor: rest.length > limit && last ? encodeCursor([last.name, last.id]) : null,
      };
    });
  }

  updateName(id: OrganizationId, name: string, updatedAt: Date): Promise<Organization | null> {
    const found = this.byId.get(id);
    if (!found) return Promise.resolve(null);
    const updated: Organization = { ...found, name, updatedAt };
    this.byId.set(id, updated);
    return Promise.resolve(structuredClone(updated));
  }

  delete(id: OrganizationId): Promise<boolean> {
    const found = this.byId.get(id);
    if (!found) return Promise.resolve(false);
    this.byId.delete(id);
    this.bySlug.delete(found.slug);
    return Promise.resolve(true);
  }

  count(): Promise<number> {
    return Promise.resolve(this.byId.size);
  }
}
