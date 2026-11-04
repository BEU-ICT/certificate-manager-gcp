import type { EventRepository, Page, PageRequest } from '../../ports/index.js';
import type { CertificateEvent } from '../../shared/domain.js';
import { ConflictError } from '../../shared/errors.js';
import type { EventId, OrganizationId } from '../../shared/ids.js';
import { MemoryTable } from './memory-table.js';

export class FakeEventRepository implements EventRepository {
  private readonly table = new MemoryTable<CertificateEvent>();

  create(event: CertificateEvent): Promise<void> {
    if (this.table.find((e) => e.id === event.id)) {
      return Promise.reject(new ConflictError('Event already exists'));
    }
    if (
      this.table.find((e) => e.organizationId === event.organizationId && e.slug === event.slug)
    ) {
      return Promise.reject(new ConflictError('Event slug is already taken in this organization'));
    }
    this.table.add(event, event.createdAt);
    return Promise.resolve();
  }

  getById(id: EventId): Promise<CertificateEvent | null> {
    const row = this.table.find((e) => e.id === id);
    return Promise.resolve(row ? structuredClone(row.item) : null);
  }

  getBySlug(organizationId: OrganizationId, slug: string): Promise<CertificateEvent | null> {
    const row = this.table.find((e) => e.organizationId === organizationId && e.slug === slug);
    return Promise.resolve(row ? structuredClone(row.item) : null);
  }

  listByOrganization(
    organizationId: OrganizationId,
    page?: PageRequest,
  ): Promise<Page<CertificateEvent>> {
    return Promise.resolve().then(() =>
      this.table.paginate(
        this.table.select((e) => e.organizationId === organizationId),
        page,
      ),
    );
  }

  count(organizationId?: OrganizationId): Promise<number> {
    const rows = this.table.select(
      (e) => organizationId === undefined || e.organizationId === organizationId,
    );
    return Promise.resolve(rows.length);
  }
}
