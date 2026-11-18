import type { OrganizationRepository, Page, PageRequest } from '../../ports/index.js';
import { decodeCursor, pageLimit } from '../../shared/cursor.js';
import type { Organization } from '../../shared/domain.js';
import { ConflictError, SlugTakenError } from '../../shared/errors.js';
import type { OrganizationId } from '../../shared/ids.js';
import { mapConflict, type Queryable } from './db.js';
import { keysetCondition, keysetOrderBy, toKeysetPage, type KeysetColumn } from './keyset.js';

const GET_MANY_LIMIT = 100;
const ORDER: readonly KeysetColumn[] = [
  { column: 'name', direction: 'asc' },
  { column: 'id', direction: 'asc' },
];

interface Row {
  id: string;
  slug: string;
  name: string;
  created_at: Date;
  updated_at: Date;
  schema_version: number;
}

const toOrganization = (r: Row): Organization => ({
  id: r.id as OrganizationId,
  slug: r.slug,
  name: r.name,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  schemaVersion: r.schema_version,
});

/** PostgreSQL {@link OrganizationRepository}; slug uniqueness is the `organizations_slug_key` index. */
export class PostgresOrganizationRepository implements OrganizationRepository {
  constructor(private readonly db: Queryable) {}

  create(o: Organization): Promise<void> {
    return mapConflict(
      async () => {
        await this.db.query(
          `INSERT INTO organizations (id, slug, name, created_at, updated_at, schema_version)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [o.id, o.slug, o.name, o.createdAt, o.updatedAt, o.schemaVersion],
        );
      },
      (constraint) =>
        constraint === 'organizations_slug_key'
          ? new SlugTakenError('Organization')
          : new ConflictError('Organization already exists'),
    );
  }

  async getById(id: OrganizationId): Promise<Organization | null> {
    const { rows } = await this.db.query<Row>('SELECT * FROM organizations WHERE id = $1', [id]);
    return rows[0] ? toOrganization(rows[0]) : null;
  }

  async getBySlug(slug: string): Promise<Organization | null> {
    const { rows } = await this.db.query<Row>('SELECT * FROM organizations WHERE slug = $1', [
      slug,
    ]);
    return rows[0] ? toOrganization(rows[0]) : null;
  }

  async getMany(ids: readonly OrganizationId[]): Promise<Organization[]> {
    const unique = [...new Set(ids)].slice(0, GET_MANY_LIMIT);
    if (unique.length === 0) return [];
    const { rows } = await this.db.query<Row>('SELECT * FROM organizations WHERE id = ANY($1)', [
      unique,
    ]);
    return rows.map(toOrganization);
  }

  async list(page?: PageRequest): Promise<Page<Organization>> {
    const limit = pageLimit(page);
    const params: unknown[] = [];
    let where = '';
    if (page?.cursor !== undefined) {
      const cond = keysetCondition(ORDER, decodeCursor(page.cursor, 2).map(String), 1);
      where = `WHERE ${cond.sql}`;
      params.push(...cond.params);
    }
    params.push(limit + 1);
    const { rows } = await this.db.query<Row>(
      `SELECT * FROM organizations ${where} ${keysetOrderBy(ORDER)} LIMIT $${String(params.length)}`,
      params,
    );
    return toKeysetPage(rows.map(toOrganization), limit, (o) => [o.name, o.id]);
  }

  async updateName(
    id: OrganizationId,
    name: string,
    updatedAt: Date,
  ): Promise<Organization | null> {
    const { rows } = await this.db.query<Row>(
      'UPDATE organizations SET name = $2, updated_at = $3 WHERE id = $1 RETURNING *',
      [id, name, updatedAt],
    );
    return rows[0] ? toOrganization(rows[0]) : null;
  }

  async delete(id: OrganizationId): Promise<boolean> {
    const r = await this.db.query('DELETE FROM organizations WHERE id = $1', [id]);
    return (r.rowCount ?? 0) > 0;
  }

  async count(): Promise<number> {
    const { rows } = await this.db.query<{ n: string }>('SELECT count(*) AS n FROM organizations');
    return Number(rows[0]?.n ?? 0);
  }
}
