import type { EventRepository, Page, PageRequest } from '../../ports/index.js';
import { decodeCursor, pageLimit } from '../../shared/cursor.js';
import type { CertificateEvent, EmailLanguage } from '../../shared/domain.js';
import { ConflictError, SlugTakenError } from '../../shared/errors.js';
import type { EventId, OrganizationId } from '../../shared/ids.js';
import { mapConflict, type Queryable } from './db.js';
import { keysetCondition, keysetOrderBy, toKeysetPage, type KeysetColumn } from './keyset.js';

const ORDER: readonly KeysetColumn[] = [
  { column: 'created_at', direction: 'desc' },
  { column: 'id', direction: 'desc' },
];

interface Row {
  id: string;
  organization_id: string;
  slug: string;
  name: string;
  email_language: EmailLanguage;
  created_at: Date;
  updated_at: Date;
  schema_version: number;
}

const toEvent = (r: Row): CertificateEvent => ({
  id: r.id as EventId,
  organizationId: r.organization_id as OrganizationId,
  slug: r.slug,
  name: r.name,
  emailLanguage: r.email_language,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  schemaVersion: r.schema_version,
});

/** PostgreSQL {@link EventRepository}; `(organization_id, slug)` uniqueness is a unique index. */
export class PostgresEventRepository implements EventRepository {
  constructor(private readonly db: Queryable) {}

  create(e: CertificateEvent): Promise<void> {
    return mapConflict(
      async () => {
        await this.db.query(
          `INSERT INTO events (id, organization_id, slug, name, email_language, created_at, updated_at, schema_version)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            e.id,
            e.organizationId,
            e.slug,
            e.name,
            e.emailLanguage,
            e.createdAt,
            e.updatedAt,
            e.schemaVersion,
          ],
        );
      },
      (constraint) =>
        constraint === 'events_organization_slug_key'
          ? new SlugTakenError('Event')
          : new ConflictError('Event already exists'),
    );
  }

  async getById(id: EventId): Promise<CertificateEvent | null> {
    const { rows } = await this.db.query<Row>('SELECT * FROM events WHERE id = $1', [id]);
    return rows[0] ? toEvent(rows[0]) : null;
  }

  async getBySlug(organizationId: OrganizationId, slug: string): Promise<CertificateEvent | null> {
    const { rows } = await this.db.query<Row>(
      'SELECT * FROM events WHERE organization_id = $1 AND slug = $2',
      [organizationId, slug],
    );
    return rows[0] ? toEvent(rows[0]) : null;
  }

  async list(
    filter: { organizationId?: OrganizationId } = {},
    page?: PageRequest,
  ): Promise<Page<CertificateEvent>> {
    const limit = pageLimit(page);
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.organizationId !== undefined) {
      params.push(filter.organizationId);
      where.push(`organization_id = $${String(params.length)}`);
    }
    if (page?.cursor !== undefined) {
      const [millis, id] = decodeCursor(page.cursor, 2);
      const cond = keysetCondition(
        ORDER,
        [new Date(Number(millis)), String(id)],
        params.length + 1,
      );
      where.push(cond.sql);
      params.push(...cond.params);
    }
    params.push(limit + 1);
    const { rows } = await this.db.query<Row>(
      `SELECT * FROM events ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ${keysetOrderBy(ORDER)} LIMIT $${String(params.length)}`,
      params,
    );
    return toKeysetPage(rows.map(toEvent), limit, (e) => [e.createdAt.getTime(), e.id]);
  }

  async update(
    id: EventId,
    changes: { name?: string; emailLanguage?: EmailLanguage },
    updatedAt: Date,
  ): Promise<CertificateEvent | null> {
    const { rows } = await this.db.query<Row>(
      `UPDATE events SET name = COALESCE($2, name), email_language = COALESCE($3, email_language),
         updated_at = $4 WHERE id = $1 RETURNING *`,
      [id, changes.name ?? null, changes.emailLanguage ?? null, updatedAt],
    );
    return rows[0] ? toEvent(rows[0]) : null;
  }

  async delete(id: EventId): Promise<boolean> {
    const r = await this.db.query('DELETE FROM events WHERE id = $1', [id]);
    return (r.rowCount ?? 0) > 0;
  }

  async count(organizationId?: OrganizationId): Promise<number> {
    const { rows } =
      organizationId === undefined
        ? await this.db.query<{ n: string }>('SELECT count(*) AS n FROM events')
        : await this.db.query<{ n: string }>(
            'SELECT count(*) AS n FROM events WHERE organization_id = $1',
            [organizationId],
          );
    return Number(rows[0]?.n ?? 0);
  }
}
