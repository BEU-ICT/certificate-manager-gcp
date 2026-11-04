import type { OrganizationRepository, Page, PageRequest } from '../../ports/index.js';
import type { Organization } from '../../shared/domain.js';
import { ConflictError } from '../../shared/errors.js';
import type { OrganizationId } from '../../shared/ids.js';
import { MemoryTable } from './memory-table.js';

export class FakeOrganizationRepository implements OrganizationRepository {
  private readonly table = new MemoryTable<Organization>();

  create(organization: Organization): Promise<void> {
    if (this.table.find((o) => o.id === organization.id)) {
      return Promise.reject(new ConflictError('Organization already exists'));
    }
    if (this.table.find((o) => o.slug === organization.slug)) {
      return Promise.reject(new ConflictError('Organization slug is already taken'));
    }
    this.table.add(organization, organization.createdAt);
    return Promise.resolve();
  }

  getById(id: OrganizationId): Promise<Organization | null> {
    const row = this.table.find((o) => o.id === id);
    return Promise.resolve(row ? structuredClone(row.item) : null);
  }

  getBySlug(slug: string): Promise<Organization | null> {
    const row = this.table.find((o) => o.slug === slug);
    return Promise.resolve(row ? structuredClone(row.item) : null);
  }

  list(page?: PageRequest): Promise<Page<Organization>> {
    return Promise.resolve().then(() => this.table.paginate(this.table.select(), page));
  }

  count(): Promise<number> {
    return Promise.resolve(this.table.rows.length);
  }
}
