import type { Pool } from 'pg';
import type {
  CertificateFilter,
  CertificateRepository,
  EmailStatePatch,
  MarkRevokedResult,
  Page,
  PageRequest,
  PrepareEmailResendInput,
  PrepareEmailResendResult,
  ReserveEmailSendResult,
  SetPdfPathResult,
} from '../../ports/index.js';
import type { CertificateType } from '../../shared/certificate-types.js';
import { decodeIssuedAtCursor, pageLimit } from '../../shared/cursor.js';
import type { Certificate, CertificateStatus, EmailStatus } from '../../shared/domain.js';
import { ConflictError, ValidationError } from '../../shared/errors.js';
import type { CertificateId, EventId, OrganizationId, TemplateRef } from '../../shared/ids.js';
import { mapConflict } from './db.js';
import { keysetCondition, keysetOrderBy, toKeysetPage, type KeysetColumn } from './keyset.js';
import { withTransaction } from './pool.js';

/** Same limits as the Firestore adapter (one batch). */
export const MAX_CREATE_MANY = 500;
const ORDER: readonly KeysetColumn[] = [
  { column: 'issued_at', direction: 'desc' },
  { column: 'id', direction: 'desc' },
];

interface Row {
  id: string;
  organization_id: string;
  event_id: string;
  organization_name: string;
  event_name: string;
  template_id: string;
  type: string;
  owner_name: string;
  email: string | null;
  subject: string;
  skills: string[];
  status: CertificateStatus;
  issued_at: Date;
  revoked_at: Date | null;
  revoke_reason: string | null;
  email_status: EmailStatus;
  email_attempts: number;
  email_sent_at: Date | null;
  email_last_error: string | null;
  pdf_path: string | null;
  pdf_generated_at: Date | null;
  legacy: NonNullable<Certificate['legacy']> | null;
  created_by: string;
  created_at: Date;
  updated_at: Date;
  schema_version: number;
}

function toCertificate(r: Row): Certificate {
  return {
    id: r.id as CertificateId,
    organizationId: r.organization_id as OrganizationId,
    eventId: r.event_id as EventId,
    organizationName: r.organization_name,
    eventName: r.event_name,
    templateId: r.template_id as TemplateRef,
    type: r.type as CertificateType,
    ownerName: r.owner_name,
    ...(r.email !== null && { email: r.email }),
    subject: r.subject,
    skills: r.skills,
    status: r.status,
    issuedAt: r.issued_at,
    ...(r.revoked_at !== null && { revokedAt: r.revoked_at }),
    ...(r.revoke_reason !== null && { revokeReason: r.revoke_reason }),
    emailStatus: r.email_status,
    emailAttempts: r.email_attempts,
    ...(r.email_sent_at !== null && { emailSentAt: r.email_sent_at }),
    ...(r.email_last_error !== null && { emailLastError: r.email_last_error }),
    ...(r.pdf_path !== null && { pdfPath: r.pdf_path }),
    ...(r.pdf_generated_at !== null && { pdfGeneratedAt: r.pdf_generated_at }),
    ...(r.legacy !== null && { legacy: r.legacy }),
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    schemaVersion: r.schema_version,
  };
}

const COLUMNS = 26;
const INSERT_HEAD = `INSERT INTO certificates (id, organization_id, event_id, organization_name,
  event_name, template_id, type, owner_name, email, subject, skills, status, issued_at, revoked_at,
  revoke_reason, email_status, email_attempts, email_sent_at, email_last_error, pdf_path,
  pdf_generated_at, legacy, created_by, created_at, updated_at, schema_version) VALUES `;

function values(c: Certificate): unknown[] {
  return [
    c.id,
    c.organizationId,
    c.eventId,
    c.organizationName,
    c.eventName,
    c.templateId,
    c.type,
    c.ownerName,
    c.email ?? null,
    c.subject,
    [...c.skills],
    c.status,
    c.issuedAt,
    c.revokedAt ?? null,
    c.revokeReason ?? null,
    c.emailStatus,
    c.emailAttempts,
    c.emailSentAt ?? null,
    c.emailLastError ?? null,
    c.pdfPath ?? null,
    c.pdfGeneratedAt ?? null,
    c.legacy === undefined ? null : JSON.stringify(c.legacy),
    c.createdBy,
    c.createdAt,
    c.updatedAt,
    c.schemaVersion,
  ];
}

const conflict = () => new ConflictError('Certificate already exists');

/**
 * PostgreSQL {@link CertificateRepository}. Conditional writes are single `UPDATE ... WHERE`
 * statements (row-locked, so races have exactly one winner); `createMany` is one multi-row
 * `INSERT` (atomic); `prepareEmailResend` locks its row with `FOR UPDATE`. No method locks more
 * than one row, so there is no lock-ordering/deadlock risk.
 */
export class PostgresCertificateRepository implements CertificateRepository {
  constructor(private readonly pool: Pool) {}

  create(c: Certificate): Promise<void> {
    return mapConflict(async () => {
      const marks = values(c).map((_, i) => `$${String(i + 1)}`);
      await this.pool.query(`${INSERT_HEAD}(${marks.join(', ')})`, values(c));
    }, conflict);
  }

  async createMany(certificates: readonly Certificate[]): Promise<void> {
    if (certificates.length > MAX_CREATE_MANY) {
      throw new ValidationError(`At most ${String(MAX_CREATE_MANY)} certificates per batch`);
    }
    if (new Set(certificates.map((c) => c.id)).size !== certificates.length) throw conflict();
    if (certificates.length === 0) return;
    const params = certificates.flatMap(values);
    const tuples = certificates.map(
      (_, row) =>
        `(${Array.from({ length: COLUMNS }, (_c, col) => `$${String(row * COLUMNS + col + 1)}`).join(', ')})`,
    );
    await mapConflict(async () => {
      await this.pool.query(INSERT_HEAD + tuples.join(', '), params);
    }, conflict);
  }

  async getById(id: CertificateId): Promise<Certificate | null> {
    const { rows } = await this.pool.query<Row>('SELECT * FROM certificates WHERE id = $1', [id]);
    return rows[0] ? toCertificate(rows[0]) : null;
  }

  async getMany(ids: readonly CertificateId[]): Promise<Certificate[]> {
    if (ids.length > MAX_CREATE_MANY) {
      throw new ValidationError(`At most ${String(MAX_CREATE_MANY)} certificates per read`);
    }
    const unique = [...new Set(ids)];
    if (unique.length === 0) return [];
    const { rows } = await this.pool.query<Row>('SELECT * FROM certificates WHERE id = ANY($1)', [
      unique,
    ]);
    const byId = new Map(rows.map((r) => [r.id, toCertificate(r)]));
    return unique.flatMap((id) => byId.get(id) ?? []);
  }

  private where(filter: CertificateFilter): { conditions: string[]; params: unknown[] } {
    const conditions: string[] = [];
    const params: unknown[] = [];
    const add = (sql: (n: string) => string, value: unknown) => {
      if (value === undefined) return;
      params.push(value);
      conditions.push(sql(`$${String(params.length)}`));
    };
    add((n) => `organization_id = ${n}`, filter.organizationId);
    add((n) => `event_id = ${n}`, filter.eventId);
    add((n) => `type = ${n}`, filter.type);
    add((n) => `status = ${n}`, filter.status);
    add((n) => `email_status = ${n}`, filter.emailStatus);
    add((n) => `issued_at >= ${n}`, filter.issuedFrom);
    add((n) => `issued_at < ${n}`, filter.issuedTo);
    return { conditions, params };
  }

  async list(filter: CertificateFilter, page?: PageRequest): Promise<Page<Certificate>> {
    const limit = pageLimit(page);
    const { conditions, params } = this.where(filter);
    if (page?.cursor !== undefined) {
      const { issuedAtMillis, id } = decodeIssuedAtCursor(page.cursor);
      const cond = keysetCondition(ORDER, [new Date(issuedAtMillis), id], params.length + 1);
      conditions.push(cond.sql);
      params.push(...cond.params);
    }
    params.push(limit + 1);
    const { rows } = await this.pool.query<Row>(
      `SELECT * FROM certificates ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
       ${keysetOrderBy(ORDER)} LIMIT $${String(params.length)}`,
      params,
    );
    return toKeysetPage(rows.map(toCertificate), limit, (c) => [c.issuedAt.getTime(), c.id]);
  }

  async count(filter: CertificateFilter): Promise<number> {
    const { conditions, params } = this.where(filter);
    const { rows } = await this.pool.query<{ n: string }>(
      `SELECT count(*) AS n FROM certificates ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}`,
      params,
    );
    return Number(rows[0]?.n ?? 0);
  }

  async markRevoked(
    id: CertificateId,
    revocation: { reason: string; at: Date },
  ): Promise<MarkRevokedResult> {
    // `pdf_path` is not touched by the update, so RETURNING it yields the previous value.
    const updated = await this.pool.query<{ pdf_path: string | null }>(
      `UPDATE certificates SET status = 'revoked', revoked_at = $2, revoke_reason = $3, updated_at = $2
       WHERE id = $1 AND status = 'active' RETURNING pdf_path`,
      [id, revocation.at, revocation.reason],
    );
    if (updated.rows[0]) return { outcome: 'revoked', previousPdfPath: updated.rows[0].pdf_path };
    const exists = await this.pool.query('SELECT 1 FROM certificates WHERE id = $1', [id]);
    return { outcome: exists.rowCount ? 'already_revoked' : 'not_found' };
  }

  async clearPdfPath(id: CertificateId): Promise<boolean> {
    const r = await this.pool.query(
      'UPDATE certificates SET pdf_path = NULL, pdf_generated_at = NULL WHERE id = $1',
      [id],
    );
    return (r.rowCount ?? 0) > 0;
  }

  async setPdfPathIfAbsent(
    id: CertificateId,
    pdf: { pdfPath: string; generatedAt: Date },
  ): Promise<SetPdfPathResult | null> {
    const won = await this.pool.query<{ status: CertificateStatus }>(
      `UPDATE certificates SET pdf_path = $2, pdf_generated_at = $3
       WHERE id = $1 AND pdf_path IS NULL AND status = 'active' RETURNING status`,
      [id, pdf.pdfPath, pdf.generatedAt],
    );
    if (won.rows[0]) return { winner: true, pdfPath: pdf.pdfPath, status: won.rows[0].status };
    const { rows } = await this.pool.query<{ pdf_path: string | null; status: CertificateStatus }>(
      'SELECT pdf_path, status FROM certificates WHERE id = $1',
      [id],
    );
    const row = rows[0];
    return row ? { winner: false, pdfPath: row.pdf_path, status: row.status } : null;
  }

  async updateEmailState(id: CertificateId, patch: EmailStatePatch): Promise<boolean> {
    const sets: string[] = [];
    const params: unknown[] = [id];
    const set = (column: string, value: unknown) => {
      params.push(value);
      sets.push(`${column} = $${String(params.length)}`);
    };
    if (patch.emailStatus !== undefined) set('email_status', patch.emailStatus);
    if (patch.emailAttempts !== undefined) set('email_attempts', patch.emailAttempts);
    if (patch.emailSentAt !== undefined) set('email_sent_at', patch.emailSentAt);
    if (patch.emailLastError !== undefined) set('email_last_error', patch.emailLastError);
    set('updated_at', patch.updatedAt);
    const r = await this.pool.query(
      `UPDATE certificates SET ${sets.join(', ')} WHERE id = $1`,
      params,
    );
    return (r.rowCount ?? 0) > 0;
  }

  async reserveEmailSend(
    id: CertificateId,
    options: { at: Date; firstSendOnly: boolean },
  ): Promise<ReserveEmailSendResult> {
    const guard = options.firstSendOnly
      ? "AND status = 'active' AND email_status = 'pending' AND email_attempts = 0"
      : '';
    const r = await this.pool.query<{ email_attempts: number }>(
      `UPDATE certificates SET email_attempts = email_attempts + 1, updated_at = $2
       WHERE id = $1 ${guard} RETURNING email_attempts`,
      [id, options.at],
    );
    if (r.rows[0]) return { outcome: 'reserved', sequence: r.rows[0].email_attempts };
    const exists = await this.pool.query('SELECT 1 FROM certificates WHERE id = $1', [id]);
    return { outcome: exists.rowCount ? 'not_eligible' : 'not_found' };
  }

  prepareEmailResend(
    id: CertificateId,
    input: PrepareEmailResendInput,
  ): Promise<PrepareEmailResendResult> {
    return withTransaction(this.pool, async (client): Promise<PrepareEmailResendResult> => {
      const { rows } = await client.query<Row>(
        'SELECT * FROM certificates WHERE id = $1 FOR UPDATE',
        [id],
      );
      const data = rows[0];
      if (!data) return { outcome: 'not_found' };
      if (data.status !== 'active') return { outcome: 'revoked' };
      const address = input.email ?? data.email;
      if (address === null || address === undefined || address === '') {
        return { outcome: 'email_required' };
      }
      if (
        data.email_status === 'pending' &&
        data.updated_at.getTime() >= input.stuckBefore.getTime()
      ) {
        return { outcome: 'in_progress' };
      }
      const sequence = data.email_attempts + 1;
      await client.query(
        `UPDATE certificates SET email = COALESCE($2, email), email_status = 'pending',
           email_last_error = NULL, email_attempts = $3, updated_at = $4 WHERE id = $1`,
        [id, input.email ?? null, sequence, input.at],
      );
      return {
        outcome: 'reserved',
        sequence,
        emailChanged: input.email !== undefined && input.email !== data.email,
      };
    });
  }

  async countByTemplate(ref: TemplateRef): Promise<number> {
    const { rows } = await this.pool.query<{ n: string }>(
      'SELECT count(*) AS n FROM certificates WHERE template_id = $1',
      [ref],
    );
    return Number(rows[0]?.n ?? 0);
  }

  countByOrganization(organizationId: OrganizationId): Promise<number> {
    return this.count({ organizationId });
  }

  countByEvent(eventId: EventId): Promise<number> {
    return this.count({ eventId });
  }
}
