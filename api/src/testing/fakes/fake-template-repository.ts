import type { Page, PageRequest, TemplateRepository } from '../../ports/index.js';
import type { Template } from '../../shared/domain.js';
import { ConflictError } from '../../shared/errors.js';
import type { EventId, OrganizationId, TemplateRef } from '../../shared/ids.js';
import { MemoryTable } from './memory-table.js';

export class FakeTemplateRepository implements TemplateRepository {
  private readonly table = new MemoryTable<Template>();

  create(template: Template): Promise<void> {
    if (this.table.find((t) => t.ref === template.ref)) {
      return Promise.reject(new ConflictError('Template reference already exists'));
    }
    this.table.add(template, template.createdAt);
    return Promise.resolve();
  }

  getByRef(ref: TemplateRef): Promise<Template | null> {
    const row = this.table.find((t) => t.ref === ref);
    return Promise.resolve(row ? structuredClone(row.item) : null);
  }

  getLatest(
    organizationId: OrganizationId,
    eventId: EventId,
    type: string,
  ): Promise<Template | null> {
    const matches = this.table
      .select(
        (t) => t.organizationId === organizationId && t.eventId === eventId && t.type === type,
      )
      .map((row) => row.item);
    const latest = matches.reduce<Template | null>(
      (best, t) => (best === null || t.version > best.version ? t : best),
      null,
    );
    return Promise.resolve(latest ? structuredClone(latest) : null);
  }

  listByEvent(eventId: EventId, page?: PageRequest): Promise<Page<Template>> {
    return Promise.resolve().then(() =>
      this.table.paginate(
        this.table.select((t) => t.eventId === eventId),
        page,
      ),
    );
  }
}
