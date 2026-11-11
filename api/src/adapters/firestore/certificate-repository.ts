import {
  FieldPath,
  FieldValue,
  Timestamp,
  type Firestore,
  type Query,
} from 'firebase-admin/firestore';
import type {
  CertificateFilter,
  CertificateRepository,
  EmailStatePatch,
  MarkRevokedResult,
  Page,
  PageRequest,
  SetPdfPathResult,
} from '../../ports/index.js';
import type { CertificateType } from '../../shared/certificate-types.js';
import { decodeIssuedAtCursor, encodeIssuedAtCursor, pageLimit } from '../../shared/cursor.js';
import type { Certificate, CertificateStatus, EmailStatus } from '../../shared/domain.js';
import { ConflictError, ValidationError } from '../../shared/errors.js';
import type { CertificateId, EventId, OrganizationId, TemplateRef } from '../../shared/ids.js';

export const CERTIFICATES_COLLECTION = 'certificates';
/** Firestore allows 500 writes per batch. */
export const MAX_CREATE_MANY = 500;
/** Documents per `getAll` call of `getMany`. */
const GET_MANY_CHUNK = 100;
/** gRPC status ALREADY_EXISTS, raised by `create()` on an existing document. */
const ALREADY_EXISTS = 6;

/** Stored shape: relations are string IDs, instants are `Timestamp`, absent optionals are omitted. */
interface CertificateDocument {
  organizationId: string;
  eventId: string;
  organizationName: string;
  eventName: string;
  templateId: string;
  type: CertificateType;
  ownerName: string;
  email?: string;
  subject: string;
  skills: string[];
  status: CertificateStatus;
  issuedAt: Timestamp;
  revokedAt?: Timestamp;
  revokeReason?: string;
  emailStatus: EmailStatus;
  emailAttempts?: number;
  emailSentAt?: Timestamp;
  emailLastError?: string;
  pdfPath?: string;
  pdfGeneratedAt?: Timestamp;
  legacy?: { id: string; certificateType?: string; template?: string };
  createdBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  schemaVersion: number;
}

const ts = (d: Date): Timestamp => Timestamp.fromDate(d);

function toDocument(c: Certificate): CertificateDocument {
  return {
    organizationId: c.organizationId,
    eventId: c.eventId,
    organizationName: c.organizationName,
    eventName: c.eventName,
    templateId: c.templateId,
    type: c.type,
    ownerName: c.ownerName,
    ...(c.email !== undefined && { email: c.email }),
    subject: c.subject,
    skills: [...c.skills],
    status: c.status,
    issuedAt: ts(c.issuedAt),
    ...(c.revokedAt !== undefined && { revokedAt: ts(c.revokedAt) }),
    ...(c.revokeReason !== undefined && { revokeReason: c.revokeReason }),
    emailStatus: c.emailStatus,
    emailAttempts: c.emailAttempts,
    ...(c.emailSentAt !== undefined && { emailSentAt: ts(c.emailSentAt) }),
    ...(c.emailLastError !== undefined && { emailLastError: c.emailLastError }),
    ...(c.pdfPath !== undefined && { pdfPath: c.pdfPath }),
    ...(c.pdfGeneratedAt !== undefined && { pdfGeneratedAt: ts(c.pdfGeneratedAt) }),
    ...(c.legacy !== undefined && {
      legacy: {
        id: c.legacy.id,
        ...(c.legacy.certificateType !== undefined && {
          certificateType: c.legacy.certificateType,
        }),
        ...(c.legacy.template !== undefined && { template: c.legacy.template }),
      },
    }),
    createdBy: c.createdBy,
    createdAt: ts(c.createdAt),
    updatedAt: ts(c.updatedAt),
    schemaVersion: c.schemaVersion,
  };
}

function toCertificate(id: string, d: CertificateDocument): Certificate {
  return {
    id: id as CertificateId,
    organizationId: d.organizationId as OrganizationId,
    eventId: d.eventId as EventId,
    organizationName: d.organizationName,
    eventName: d.eventName,
    templateId: d.templateId as TemplateRef,
    type: d.type,
    ownerName: d.ownerName,
    ...(d.email !== undefined && { email: d.email }),
    subject: d.subject,
    skills: d.skills,
    status: d.status,
    issuedAt: d.issuedAt.toDate(),
    ...(d.revokedAt !== undefined && { revokedAt: d.revokedAt.toDate() }),
    ...(d.revokeReason !== undefined && { revokeReason: d.revokeReason }),
    emailStatus: d.emailStatus,
    emailAttempts: d.emailAttempts ?? 0,
    ...(d.emailSentAt !== undefined && { emailSentAt: d.emailSentAt.toDate() }),
    ...(d.emailLastError !== undefined && { emailLastError: d.emailLastError }),
    ...(d.pdfPath !== undefined && { pdfPath: d.pdfPath }),
    ...(d.pdfGeneratedAt !== undefined && { pdfGeneratedAt: d.pdfGeneratedAt.toDate() }),
    ...(d.legacy !== undefined && { legacy: d.legacy }),
    createdBy: d.createdBy,
    createdAt: d.createdAt.toDate(),
    updatedAt: d.updatedAt.toDate(),
    schemaVersion: d.schemaVersion,
  };
}

const isAlreadyExists = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (error as { code?: unknown }).code === ALREADY_EXISTS;

/**
 * Firestore implementation of {@link CertificateRepository}. Filters are equality conditions plus
 * an `issuedAt` range, ordered `issuedAt desc, id desc`; they rely on Firestore index merging with
 * the composite indexes in `infra/firestore.indexes.json` (checked by `scripts/verify-indexes.ts`).
 * The emulator does not validate indexes.
 */
export class FirestoreCertificateRepository implements CertificateRepository {
  constructor(private readonly db: Firestore) {}

  private get collection() {
    return this.db.collection(CERTIFICATES_COLLECTION);
  }

  async create(certificate: Certificate): Promise<void> {
    try {
      await this.collection.doc(certificate.id).create(toDocument(certificate));
    } catch (error) {
      if (isAlreadyExists(error)) throw new ConflictError('Certificate already exists');
      throw error;
    }
  }

  async createMany(certificates: readonly Certificate[]): Promise<void> {
    if (certificates.length > MAX_CREATE_MANY) {
      throw new ValidationError(`At most ${String(MAX_CREATE_MANY)} certificates per batch`);
    }
    if (new Set(certificates.map((c) => c.id)).size !== certificates.length) {
      throw new ConflictError('Certificate already exists');
    }
    if (certificates.length === 0) return;
    const batch = this.db.batch();
    for (const c of certificates) batch.create(this.collection.doc(c.id), toDocument(c));
    try {
      await batch.commit();
    } catch (error) {
      if (isAlreadyExists(error)) throw new ConflictError('Certificate already exists');
      throw error;
    }
  }

  async getById(id: CertificateId): Promise<Certificate | null> {
    const snap = await this.collection.doc(id).get();
    return snap.exists ? toCertificate(snap.id, snap.data() as CertificateDocument) : null;
  }

  async getMany(ids: readonly CertificateId[]): Promise<Certificate[]> {
    if (ids.length > MAX_CREATE_MANY) {
      throw new ValidationError(`At most ${String(MAX_CREATE_MANY)} certificates per read`);
    }
    const unique = [...new Set(ids)];
    const byId = new Map<string, Certificate>();
    for (let i = 0; i < unique.length; i += GET_MANY_CHUNK) {
      const chunk = unique.slice(i, i + GET_MANY_CHUNK);
      const snaps = await this.db.getAll(...chunk.map((id) => this.collection.doc(id)));
      for (const snap of snaps) {
        if (snap.exists)
          byId.set(snap.id, toCertificate(snap.id, snap.data() as CertificateDocument));
      }
    }
    return unique.flatMap((id) => byId.get(id) ?? []);
  }

  private filtered(filter: CertificateFilter): Query {
    let query: Query = this.collection;
    if (filter.organizationId !== undefined) {
      query = query.where('organizationId', '==', filter.organizationId);
    }
    if (filter.eventId !== undefined) query = query.where('eventId', '==', filter.eventId);
    if (filter.type !== undefined) query = query.where('type', '==', filter.type);
    if (filter.status !== undefined) query = query.where('status', '==', filter.status);
    if (filter.emailStatus !== undefined) {
      query = query.where('emailStatus', '==', filter.emailStatus);
    }
    if (filter.issuedFrom !== undefined)
      query = query.where('issuedAt', '>=', ts(filter.issuedFrom));
    if (filter.issuedTo !== undefined) query = query.where('issuedAt', '<', ts(filter.issuedTo));
    return query;
  }

  /** Reads `limit + 1` documents: the extra one only decides whether a next page exists. */
  async list(filter: CertificateFilter, page?: PageRequest): Promise<Page<Certificate>> {
    const limit = pageLimit(page);
    let query = this.filtered(filter)
      .orderBy('issuedAt', 'desc')
      .orderBy(FieldPath.documentId(), 'desc');
    if (page?.cursor !== undefined) {
      const { issuedAtMillis, id } = decodeIssuedAtCursor(page.cursor);
      query = query.startAfter(Timestamp.fromMillis(issuedAtMillis), id);
    }
    const snap = await query.limit(limit + 1).get();
    const items = snap.docs
      .slice(0, limit)
      .map((d) => toCertificate(d.id, d.data() as CertificateDocument));
    const last = items.at(-1);
    return {
      items,
      nextCursor:
        snap.docs.length > limit && last ? encodeIssuedAtCursor(last.issuedAt, last.id) : null,
    };
  }

  async count(filter: CertificateFilter): Promise<number> {
    return (await this.filtered(filter).count().get()).data().count;
  }

  markRevoked(
    id: CertificateId,
    revocation: { reason: string; at: Date },
  ): Promise<MarkRevokedResult> {
    const ref = this.collection.doc(id);
    return this.db.runTransaction(async (tx): Promise<MarkRevokedResult> => {
      const snap = await tx.get(ref);
      if (!snap.exists) return { outcome: 'not_found' };
      const data = snap.data() as CertificateDocument;
      if (data.status === 'revoked') return { outcome: 'already_revoked' };
      tx.update(ref, {
        status: 'revoked',
        revokedAt: ts(revocation.at),
        revokeReason: revocation.reason,
        updatedAt: ts(revocation.at),
      });
      return { outcome: 'revoked', previousPdfPath: data.pdfPath ?? null };
    });
  }

  clearPdfPath(id: CertificateId): Promise<boolean> {
    const ref = this.collection.doc(id);
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return false;
      tx.update(ref, { pdfPath: FieldValue.delete(), pdfGeneratedAt: FieldValue.delete() });
      return true;
    });
  }

  setPdfPathIfAbsent(
    id: CertificateId,
    pdf: { pdfPath: string; generatedAt: Date },
  ): Promise<SetPdfPathResult | null> {
    const ref = this.collection.doc(id);
    return this.db.runTransaction(async (tx): Promise<SetPdfPathResult | null> => {
      const snap = await tx.get(ref);
      if (!snap.exists) return null;
      const data = snap.data() as CertificateDocument;
      if (data.pdfPath === undefined && data.status === 'active') {
        tx.update(ref, { pdfPath: pdf.pdfPath, pdfGeneratedAt: ts(pdf.generatedAt) });
        return { winner: true, pdfPath: pdf.pdfPath, status: data.status };
      }
      return { winner: false, pdfPath: data.pdfPath ?? null, status: data.status };
    });
  }

  async updateEmailState(id: CertificateId, patch: EmailStatePatch): Promise<boolean> {
    const update: Record<string, unknown> = { updatedAt: ts(patch.updatedAt) };
    if (patch.emailStatus !== undefined) update['emailStatus'] = patch.emailStatus;
    if (patch.emailAttempts !== undefined) update['emailAttempts'] = patch.emailAttempts;
    if (patch.emailSentAt !== undefined) {
      update['emailSentAt'] =
        patch.emailSentAt === null ? FieldValue.delete() : ts(patch.emailSentAt);
    }
    if (patch.emailLastError !== undefined) {
      update['emailLastError'] =
        patch.emailLastError === null ? FieldValue.delete() : patch.emailLastError;
    }
    try {
      await this.collection.doc(id).update(update);
      return true;
    } catch (error) {
      if ((error as { code?: unknown }).code === 5) return false; // NOT_FOUND
      throw error;
    }
  }

  async countByTemplate(ref: TemplateRef): Promise<number> {
    return (await this.collection.where('templateId', '==', ref).count().get()).data().count;
  }

  countByOrganization(organizationId: OrganizationId): Promise<number> {
    return this.count({ organizationId });
  }

  countByEvent(eventId: EventId): Promise<number> {
    return this.count({ eventId });
  }
}
