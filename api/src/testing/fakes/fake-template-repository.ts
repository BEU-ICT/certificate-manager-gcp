import type { Page, PageRequest, TemplateFilter, TemplateRepository } from '../../ports/index.js';
import type { Template } from '../../shared/domain.js';
import { ConflictError } from '../../shared/errors.js';
import type { EventId, OrganizationId, TemplateRef } from '../../shared/ids.js';
import { MemoryTable } from './memory-table.js';

const matches =
  (filter: TemplateFilter) =>
  (t: Template): boolean =>
    (filter.organizationId === undefined || t.organizationId === filter.organizationId) &&
    (filter.eventId === undefined || t.eventId === filter.eventId) &&
    (filter.type === undefined || t.type === filter.type);

export class FakeTemplateRepository implements TemplateRepository {
  private readonly table = new MemoryTable<Template>();

  create(template: Template): Promise<void> {
    // No await between the check and the insert, so concurrent callers cannot both succeed.
    if (this.table.find((t) => t.reference === template.reference)) {
      return Promise.reject(new ConflictError('Template reference already exists'));
    }
    this.table.add(template, template.createdAt);
    return Promise.resolve();
  }

  getByReference(reference: TemplateRef): Promise<Template | null> {
    const row = this.table.find((t) => t.reference === reference);
    return Promise.resolve(row ? structuredClone(row.item) : null);
  }

  getLatest(
    organizationId: OrganizationId,
    eventId: EventId,
    type: string,
  ): Promise<Template | null> {
    const latest = this.table
      .select(matches({ organizationId, eventId, type }))
      .map((row) => row.item)
      .reduce<Template | null>(
        (best, t) => (best === null || t.version > best.version ? t : best),
        null,
      );
    return Promise.resolve(latest ? structuredClone(latest) : null);
  }

  async maxVersion(
    organizationId: OrganizationId,
    eventId: EventId,
    type: string,
  ): Promise<number | null> {
    return (await this.getLatest(organizationId, eventId, type))?.version ?? null;
  }

  list(filter: TemplateFilter = {}, page?: PageRequest): Promise<Page<Template>> {
    return Promise.resolve().then(() =>
      this.table.paginate(this.table.select(matches(filter)), page),
    );
  }

  count(filter: TemplateFilter = {}): Promise<number> {
    return Promise.resolve(this.table.select(matches(filter)).length);
  }
}
