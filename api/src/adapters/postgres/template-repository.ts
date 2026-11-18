import type { Page, PageRequest, TemplateFilter, TemplateRepository } from '../../ports/index.js';
import type { CertificateType } from '../../shared/certificate-types.js';
import { decodeCursor, pageLimit } from '../../shared/cursor.js';
import type { Template } from '../../shared/domain.js';
import { ConflictError } from '../../shared/errors.js';
import type { EventId, OrganizationId, TemplateRef } from '../../shared/ids.js';
import { mapConflict, type Queryable } from './db.js';
import { keysetCondition, keysetOrderBy, toKeysetPage, type KeysetColumn } from './keyset.js';

const ORDER: readonly KeysetColumn[] = [
  { column: 'created_at', direction: 'desc' },
  { column: 'reference', direction: 'desc' },
];

interface Row {
  reference: string;
  organization_id: string;
  event_id: string;
  organization_slug: string;
  event_slug: string;
  type: string;
  version: number;
  storage_path: string;
  config: Record<string, unknown>;
  created_at: Date;
  created_by: string;
  schema_version: number;
}

const toTemplate = (r: Row): Template => ({
  reference: r.reference as TemplateRef,
  organizationId: r.organization_id as OrganizationId,
  eventId: r.event_id as EventId,
  organizationSlug: r.organization_slug,
  eventSlug: r.event_slug,
  type: r.type as CertificateType,
  version: r.version,
  storagePath: r.storage_path,
  config: r.config,
  createdAt: r.created_at,
  createdBy: r.created_by,
  schemaVersion: r.schema_version,
});

/** PostgreSQL {@link TemplateRepository}; the primary key (reference) gives `create()` semantics. */
export class PostgresTemplateRepository implements TemplateRepository {
  constructor(private readonly db: Queryable) {}

  create(t: Template): Promise<void> {
    return mapConflict(
      async () => {
        await this.db.query(
          `INSERT INTO templates (reference, organization_id, event_id, organization_slug, event_slug,
             type, version, storage_path, config, created_at, created_by, schema_version)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12)`,
          [
            t.reference,
            t.organizationId,
            t.eventId,
            t.organizationSlug,
            t.eventSlug,
            t.type,
            t.version,
            t.storagePath,
            JSON.stringify(t.config),
            t.createdAt,
            t.createdBy,
            t.schemaVersion,
          ],
        );
      },
      () => new ConflictError('Template reference already exists'),
    );
  }

  async getByReference(reference: TemplateRef): Promise<Template | null> {
    const { rows } = await this.db.query<Row>('SELECT * FROM templates WHERE reference = $1', [
      reference,
    ]);
    return rows[0] ? toTemplate(rows[0]) : null;
  }

  async getLatest(
    organizationId: OrganizationId,
    eventId: EventId,
    type: string,
  ): Promise<Template | null> {
    const { rows } = await this.db.query<Row>(
      `SELECT * FROM templates WHERE organization_id = $1 AND event_id = $2 AND type = $3
       ORDER BY version DESC LIMIT 1`,
      [organizationId, eventId, type],
    );
    return rows[0] ? toTemplate(rows[0]) : null;
  }

  async maxVersion(
    organizationId: OrganizationId,
    eventId: EventId,
    type: string,
  ): Promise<number | null> {
    const { rows } = await this.db.query<{ v: number | null }>(
      `SELECT max(version) AS v FROM templates
       WHERE organization_id = $1 AND event_id = $2 AND type = $3`,
      [organizationId, eventId, type],
    );
    return rows[0]?.v ?? null;
  }

  private where(filter: TemplateFilter): { conditions: string[]; params: unknown[] } {
    const conditions: string[] = [];
    const params: unknown[] = [];
    const add = (column: string, value: string | undefined) => {
      if (value === undefined) return;
      params.push(value);
      conditions.push(`${column} = $${String(params.length)}`);
    };
    add('organization_id', filter.organizationId);
    add('event_id', filter.eventId);
    add('type', filter.type);
    return { conditions, params };
  }

  async list(filter: TemplateFilter = {}, page?: PageRequest): Promise<Page<Template>> {
    const limit = pageLimit(page);
    const { conditions, params } = this.where(filter);
    if (page?.cursor !== undefined) {
      const [millis, ref] = decodeCursor(page.cursor, 2);
      const cond = keysetCondition(
        ORDER,
        [new Date(Number(millis)), String(ref)],
        params.length + 1,
      );
      conditions.push(cond.sql);
      params.push(...cond.params);
    }
    params.push(limit + 1);
    const { rows } = await this.db.query<Row>(
      `SELECT * FROM templates ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
       ${keysetOrderBy(ORDER)} LIMIT $${String(params.length)}`,
      params,
    );
    return toKeysetPage(rows.map(toTemplate), limit, (t) => [t.createdAt.getTime(), t.reference]);
  }

  async count(filter: TemplateFilter = {}): Promise<number> {
    const { conditions, params } = this.where(filter);
    const { rows } = await this.db.query<{ n: string }>(
      `SELECT count(*) AS n FROM templates ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}`,
      params,
    );
    return Number(rows[0]?.n ?? 0);
  }
}
