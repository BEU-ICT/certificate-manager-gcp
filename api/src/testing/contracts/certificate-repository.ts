import { describe, it } from 'vitest';
import type { CertificateFilter, CertificateRepository, Cursor } from '../../ports/index.js';
import type { Certificate } from '../../shared/domain.js';
import { ConflictError, ValidationError } from '../../shared/errors.js';
import { asCertificateId, asEventId, asOrganizationId, asTemplateRef } from '../../shared/ids.js';
import { clause, type AdapterHandle, type ContractFactory } from './types.js';

const PORT = 'CertificateRepository';

export type CertificateRepositoryContractFactory = ContractFactory<CertificateRepository>;

const ORG_1 = asOrganizationId('org-1'.padEnd(22, 'x'));
const ORG_2 = asOrganizationId('org-2'.padEnd(22, 'x'));
const EVENT_1 = asEventId('evt-1'.padEnd(22, 'x'));
const EVENT_2 = asEventId('evt-2'.padEnd(22, 'x'));
const BASE = Date.UTC(2026, 0, 1, 10, 0, 0);

let counter = 0;
/** A valid certificate; every call gets a fresh id and, unless overridden, a later `issuedAt`. */
export function sampleCertificate(overrides: Partial<Certificate> = {}): Certificate {
  counter += 1;
  const issuedAt = new Date(BASE + counter * 60_000);
  return {
    id: asCertificateId(`c${String(counter).padStart(5, '0')}`.padEnd(22, 'a')),
    organizationId: ORG_1,
    eventId: EVENT_1,
    organizationName: 'Org',
    eventName: 'Event',
    templateId: asTemplateRef('attendance-v1'),
    type: 'attendance',
    ownerName: `Owner ${String(counter)}`,
    subject: 'Subject',
    skills: ['a', 'b'],
    status: 'active',
    issuedAt,
    emailStatus: 'skipped',
    emailAttempts: 0,
    createdBy: 'admin-1',
    createdAt: issuedAt,
    updatedAt: issuedAt,
    schemaVersion: 1,
    ...overrides,
  };
}

/** Executable form of the TSDoc on `CertificateRepository` (src/ports/repositories.ts). */
export function describeCertificateRepositoryContract(
  name: string,
  factory: CertificateRepositoryContractFactory,
): void {
  const test = (title: string, body: (repo: CertificateRepository) => Promise<void>) =>
    it(title, async () => {
      const handle: AdapterHandle<CertificateRepository> = await factory();
      try {
        await body(handle.adapter);
      } finally {
        await handle.cleanup();
      }
    });

  const collectIds = async (
    repo: CertificateRepository,
    filter: CertificateFilter,
    limit: number,
  ): Promise<string[]> => {
    const seen: string[] = [];
    let cursor: Cursor | undefined;
    for (let i = 0; i < 100; i++) {
      const page = await repo.list(filter, cursor === undefined ? { limit } : { limit, cursor });
      seen.push(...page.items.map((c) => c.id));
      if (page.nextCursor === null) return seen;
      cursor = page.nextCursor;
    }
    throw new Error('pagination did not terminate');
  };

  describe(`CertificateRepository contract: ${name}`, () => {
    test('create then getById round-trips every field', async (repo) => {
      const cert = sampleCertificate({
        email: 'a@example.com',
        emailStatus: 'sent',
        emailAttempts: 2,
        emailSentAt: new Date(BASE + 5),
        emailLastError: 'earlier failure',
        pdfPath: 'certificates/x.pdf',
        pdfGeneratedAt: new Date(BASE + 9),
        legacy: { id: 'old-1', certificateType: 'x' },
      });
      await repo.create(cert);
      clause(PORT, 'getById: returns the stored certificate', 'full')
        .that(await repo.getById(cert.id))
        .toEqual(cert);
      const minimal = sampleCertificate();
      await repo.create(minimal);
      clause(PORT, 'getById: absent optional fields stay absent', 'minimal')
        .that(await repo.getById(minimal.id))
        .toEqual(minimal);
      clause(PORT, 'getById: null when missing', 'unknown id')
        .that(await repo.getById(asCertificateId('z'.repeat(22))))
        .toBeNull();
    });

    test('create fails with ConflictError when the id exists', async (repo) => {
      const cert = sampleCertificate();
      await repo.create(cert);
      await clause(PORT, 'create: ConflictError when the id exists', 'duplicate').rejectedWith(
        repo.create({ ...cert, ownerName: 'Other' }),
        ConflictError,
      );
      clause(PORT, 'create: the first certificate is untouched', 'stored')
        .that((await repo.getById(cert.id))?.ownerName)
        .toBe(cert.ownerName);
    });

    test('createMany is atomic: one existing or repeated id writes nothing', async (repo) => {
      const existing = sampleCertificate();
      await repo.create(existing);
      const fresh = [sampleCertificate(), sampleCertificate()];
      await clause(PORT, 'createMany: ConflictError when an id exists', 'existing').rejectedWith(
        repo.createMany([...fresh, existing]),
        ConflictError,
      );
      await clause(PORT, 'createMany: ConflictError for a repeated id', 'repeat').rejectedWith(
        repo.createMany([fresh[0] as Certificate, fresh[0] as Certificate]),
        ConflictError,
      );
      clause(PORT, 'createMany: nothing is written on conflict', 'count')
        .that(await repo.count({}))
        .toBe(1);
      await repo.createMany(fresh);
      clause(PORT, 'createMany: writes every certificate', 'count')
        .that(await repo.count({}))
        .toBe(3);
      await clause(PORT, 'createMany: an empty batch is a no-op', 'empty').resolved(
        repo.createMany([]),
      );
    });

    test('createMany accepts 500 and rejects 501', async (repo) => {
      const many = Array.from({ length: 501 }, () => sampleCertificate());
      await clause(PORT, 'createMany: at most 500 per batch', '501').rejectedWith(
        repo.createMany(many),
        ValidationError,
      );
      clause(PORT, 'createMany: nothing written when rejected', 'count')
        .that(await repo.count({}))
        .toBe(0);
      await repo.createMany(many.slice(0, 500));
      clause(PORT, 'createMany: 500 in one batch', 'count')
        .that(await repo.count({}))
        .toBe(500);
    });

    test('list is ordered issuedAt desc then id desc, stable with identical issuedAt', async (repo) => {
      const same = new Date(BASE + 1_000_000);
      const ties = Array.from({ length: 7 }, () => sampleCertificate({ issuedAt: same }));
      const older = sampleCertificate({ issuedAt: new Date(BASE - 5000) });
      const newer = sampleCertificate({ issuedAt: new Date(BASE + 2_000_000) });
      for (const c of [older, ...ties, newer]) await repo.create(c);
      const expected = [
        newer.id,
        ...[...ties]
          .map((c) => c.id)
          .sort()
          .reverse(),
        older.id,
      ];
      clause(PORT, 'list: issuedAt desc, id desc', 'one page')
        .that(await collectIds(repo, {}, 50))
        .toEqual(expected);
      clause(PORT, 'list: tied issuedAt stays stable across page boundaries', 'pages of 2')
        .that(await collectIds(repo, {}, 2))
        .toEqual(expected);
    });

    test('120 certificates are returned exactly once across pages of 25 and 50', async (repo) => {
      const all = Array.from({ length: 120 }, (_, i) =>
        sampleCertificate({ issuedAt: new Date(BASE + Math.floor(i / 3) * 1000) }),
      );
      await repo.createMany(all.slice(0, 60));
      await repo.createMany(all.slice(60));
      for (const limit of [25, 50]) {
        const ids = await collectIds(repo, {}, limit);
        clause(PORT, 'list: every certificate exactly once', `limit ${String(limit)} count`)
          .that(ids)
          .toHaveLength(120);
        clause(PORT, 'list: every certificate exactly once', `limit ${String(limit)} unique`)
          .that(new Set(ids).size)
          .toBe(120);
      }
    });

    test('list defaults to 25 and rejects invalid limits and cursors', async (repo) => {
      await repo.createMany(Array.from({ length: 30 }, () => sampleCertificate()));
      clause(PORT, 'list: default limit is 25', 'items')
        .that((await repo.list({})).items)
        .toHaveLength(25);
      for (const limit of [0, 51]) {
        await clause(PORT, 'list: limit must be 1..50', `limit ${String(limit)}`).rejectedWith(
          repo.list({}, { limit }),
          ValidationError,
        );
      }
      const tampered = [
        'not-a-cursor',
        Buffer.from('[1]').toString('base64url'),
        Buffer.from('["a","b"]').toString('base64url'),
        Buffer.from('[1.5,"b"]').toString('base64url'),
        Buffer.from('[1,""]').toString('base64url'),
        Buffer.from('[1e20,"x"]').toString('base64url'),
        Buffer.from('[1,"a/b"]').toString('base64url'),
        Buffer.from('[253402300800000,"AAAAAAAAAAAAAAAAAAAAAA"]').toString('base64url'),
      ];
      for (const cursor of tampered) {
        await clause(PORT, 'list: a tampered cursor is a ValidationError', cursor).rejectedWith(
          repo.list({}, { cursor: cursor as never }),
          ValidationError,
        );
      }
    });

    test('every filter works alone and combined; count agrees with list', async (repo) => {
      const rows = [
        sampleCertificate(),
        sampleCertificate({ organizationId: ORG_2, eventId: EVENT_2 }),
        sampleCertificate({ eventId: EVENT_2, type: 'thanks' }),
        sampleCertificate({ status: 'revoked', revokedAt: new Date(BASE), revokeReason: 'r' }),
        sampleCertificate({ emailStatus: 'failed', email: 'f@example.com' }),
        sampleCertificate({ type: 'thanks', emailStatus: 'sent', email: 's@example.com' }),
      ];
      await repo.createMany(rows);
      const ids = (idx: number[]) => idx.map((i) => (rows[i] as Certificate).id).reverse();
      const cases: [string, CertificateFilter, number[]][] = [
        ['none', {}, [0, 1, 2, 3, 4, 5]],
        ['organizationId', { organizationId: ORG_2 }, [1]],
        ['eventId', { eventId: EVENT_2 }, [1, 2]],
        ['type', { type: 'thanks' }, [2, 5]],
        ['status', { status: 'revoked' }, [3]],
        ['emailStatus', { emailStatus: 'failed' }, [4]],
        ['org + event', { organizationId: ORG_1, eventId: EVENT_2 }, [2]],
        ['type + emailStatus', { type: 'thanks', emailStatus: 'sent' }, [5]],
        [
          'all equality',
          {
            organizationId: ORG_1,
            eventId: EVENT_1,
            type: 'attendance',
            status: 'active',
            emailStatus: 'skipped',
          },
          [0],
        ],
        ['issuedFrom inclusive', { issuedFrom: (rows[2] as Certificate).issuedAt }, [2, 3, 4, 5]],
        ['issuedTo exclusive', { issuedTo: (rows[2] as Certificate).issuedAt }, [0, 1]],
        [
          'range + equality',
          {
            issuedFrom: (rows[1] as Certificate).issuedAt,
            issuedTo: (rows[5] as Certificate).issuedAt,
            eventId: EVENT_1,
          },
          [3, 4],
        ],
        ['no match', { organizationId: asOrganizationId('nobody') }, []],
      ];
      for (const [label, filter, expected] of cases) {
        clause(PORT, 'list: filters are ANDed', `list ${label}`)
          .that(await collectIds(repo, filter, 2))
          .toEqual(ids(expected));
        clause(PORT, 'count: matches the filter', `count ${label}`)
          .that(await repo.count(filter))
          .toBe(expected.length);
      }
    });

    test('markRevoked transitions only from active and returns the previous pdfPath', async (repo) => {
      const withPdf = sampleCertificate({ pdfPath: 'certificates/a.pdf' });
      const without = sampleCertificate();
      await repo.createMany([withPdf, without]);
      const at = new Date('2026-03-01T00:00:00.000Z');
      await clause(PORT, 'markRevoked: reports the previous pdfPath', 'with pdf').resolvedTo(
        repo.markRevoked(withPdf.id, { reason: 'mistake', at }),
        { outcome: 'revoked', previousPdfPath: 'certificates/a.pdf' },
      );
      await clause(PORT, 'markRevoked: previousPdfPath null without a PDF', 'no pdf').resolvedTo(
        repo.markRevoked(without.id, { reason: 'x', at }),
        { outcome: 'revoked', previousPdfPath: null },
      );
      const stored = await repo.getById(withPdf.id);
      clause(PORT, 'markRevoked: sets status, revokedAt, revokeReason and updatedAt', 'stored')
        .that(stored)
        .toEqual({
          ...withPdf,
          status: 'revoked',
          revokedAt: at,
          revokeReason: 'mistake',
          updatedAt: at,
        });
      await clause(PORT, 'markRevoked: a revoked certificate is unchanged', 'again').resolvedTo(
        repo.markRevoked(withPdf.id, { reason: 'other', at: new Date(at.getTime() + 1000) }),
        { outcome: 'already_revoked' },
      );
      clause(PORT, 'markRevoked: first reason and time are kept', 'unchanged')
        .that(await repo.getById(withPdf.id))
        .toEqual(stored);
      await clause(PORT, 'markRevoked: not_found when missing', 'unknown').resolvedTo(
        repo.markRevoked(asCertificateId('z'.repeat(22)), { reason: 'x', at }),
        { outcome: 'not_found' },
      );
    });

    test('concurrent markRevoked: exactly one call revokes', async (repo) => {
      const cert = sampleCertificate();
      await repo.create(cert);
      const results = await Promise.all(
        Array.from({ length: 6 }, () =>
          repo.markRevoked(cert.id, { reason: 'race', at: new Date(BASE) }),
        ),
      );
      clause(PORT, 'markRevoked: transactional, one winner', 'revoked outcomes')
        .that(results.filter((r) => r.outcome === 'revoked'))
        .toHaveLength(1);
    });

    test('clearPdfPath removes pdfPath and pdfGeneratedAt', async (repo) => {
      const cert = sampleCertificate({ pdfPath: 'p.pdf', pdfGeneratedAt: new Date(BASE) });
      await repo.create(cert);
      clause(PORT, 'clearPdfPath: true when the certificate exists', 'existing')
        .that(await repo.clearPdfPath(cert.id))
        .toBe(true);
      const rest: Certificate = { ...cert };
      delete rest.pdfPath;
      delete rest.pdfGeneratedAt;
      clause(PORT, 'clearPdfPath: both fields are removed', 'stored')
        .that(await repo.getById(cert.id))
        .toEqual(rest);
      clause(PORT, 'clearPdfPath: false when missing', 'unknown')
        .that(await repo.clearPdfPath(asCertificateId('z'.repeat(22))))
        .toBe(false);
    });

    test('setPdfPathIfAbsent sets once, only for active certificates', async (repo) => {
      const cert = sampleCertificate();
      const revoked = sampleCertificate({ status: 'revoked' });
      await repo.createMany([cert, revoked]);
      const generatedAt = new Date(BASE + 77);
      await clause(PORT, 'setPdfPathIfAbsent: first call wins', 'first').resolvedTo(
        repo.setPdfPathIfAbsent(cert.id, { pdfPath: 'one.pdf', generatedAt }),
        { winner: true, pdfPath: 'one.pdf', status: 'active' },
      );
      await clause(
        PORT,
        'setPdfPathIfAbsent: later calls lose and see the winner',
        'second',
      ).resolvedTo(repo.setPdfPathIfAbsent(cert.id, { pdfPath: 'two.pdf', generatedAt }), {
        winner: false,
        pdfPath: 'one.pdf',
        status: 'active',
      });
      const stored = await repo.getById(cert.id);
      clause(PORT, 'setPdfPathIfAbsent: stores pdfPath and pdfGeneratedAt', 'stored')
        .that([stored?.pdfPath, stored?.pdfGeneratedAt])
        .toEqual(['one.pdf', generatedAt]);
      await clause(
        PORT,
        'setPdfPathIfAbsent: never sets on a revoked certificate',
        'revoked',
      ).resolvedTo(repo.setPdfPathIfAbsent(revoked.id, { pdfPath: 'x.pdf', generatedAt }), {
        winner: false,
        pdfPath: null,
        status: 'revoked',
      });
      clause(PORT, 'setPdfPathIfAbsent: null when missing', 'unknown')
        .that(
          await repo.setPdfPathIfAbsent(asCertificateId('z'.repeat(22)), {
            pdfPath: 'x.pdf',
            generatedAt,
          }),
        )
        .toBeNull();
    });

    test('concurrent setPdfPathIfAbsent: exactly one winner, all see its path', async (repo) => {
      const cert = sampleCertificate();
      await repo.create(cert);
      const results = await Promise.all(
        Array.from({ length: 8 }, (_, i) =>
          repo.setPdfPathIfAbsent(cert.id, {
            pdfPath: `p${String(i)}.pdf`,
            generatedAt: new Date(BASE),
          }),
        ),
      );
      const winners = results.filter((r) => r?.winner === true);
      clause(PORT, 'setPdfPathIfAbsent: one winner among concurrent calls', 'winners')
        .that(winners)
        .toHaveLength(1);
      clause(PORT, 'setPdfPathIfAbsent: every call reports the winning path', 'paths')
        .that(new Set(results.map((r) => r?.pdfPath)).size)
        .toBe(1);
      clause(PORT, "setPdfPathIfAbsent: the stored path is the winner's", 'stored')
        .that((await repo.getById(cert.id))?.pdfPath)
        .toBe(winners[0]?.pdfPath);
    });

    test('updateEmailState changes only the given fields and updatedAt', async (repo) => {
      const cert = sampleCertificate({
        email: 'a@example.com',
        emailStatus: 'pending',
        emailLastError: 'old',
        emailSentAt: new Date(BASE + 1),
      });
      await repo.create(cert);
      const at1 = new Date(BASE + 10_000);
      clause(PORT, 'updateEmailState: true when found', 'found')
        .that(
          await repo.updateEmailState(cert.id, {
            emailStatus: 'failed',
            emailAttempts: 3,
            emailLastError: 'boom',
            updatedAt: at1,
          }),
        )
        .toBe(true);
      clause(PORT, 'updateEmailState: only given fields change', 'failed')
        .that(await repo.getById(cert.id))
        .toEqual({
          ...cert,
          emailStatus: 'failed',
          emailAttempts: 3,
          emailLastError: 'boom',
          updatedAt: at1,
        });
      const at2 = new Date(BASE + 20_000);
      await repo.updateEmailState(cert.id, {
        emailStatus: 'sent',
        emailSentAt: at2,
        emailLastError: null,
        updatedAt: at2,
      });
      const withoutError: Certificate = { ...cert };
      delete withoutError.emailLastError;
      clause(PORT, 'updateEmailState: null clears an optional field', 'sent')
        .that(await repo.getById(cert.id))
        .toEqual({
          ...withoutError,
          emailStatus: 'sent',
          emailAttempts: 3,
          emailSentAt: at2,
          updatedAt: at2,
        });
      clause(PORT, 'updateEmailState: false when missing', 'unknown')
        .that(
          await repo.updateEmailState(asCertificateId('z'.repeat(22)), {
            emailStatus: 'sent',
            updatedAt: at2,
          }),
        )
        .toBe(false);
    });

    test('reserveEmailSend increments emailAttempts atomically', async (repo) => {
      const cert = sampleCertificate({ email: 'a@example.com', emailStatus: 'pending' });
      await repo.create(cert);
      const at = new Date(BASE + 50_000);
      clause(PORT, 'reserveEmailSend: first reservation returns 1', 'first')
        .that(await repo.reserveEmailSend(cert.id, { at, firstSendOnly: true }))
        .toEqual({ outcome: 'reserved', sequence: 1 });
      clause(PORT, 'reserveEmailSend: only emailAttempts and updatedAt change', 'fields')
        .that(await repo.getById(cert.id))
        .toEqual({ ...cert, emailAttempts: 1, updatedAt: at });
      clause(PORT, 'reserveEmailSend: firstSendOnly is not eligible twice', 'duplicate')
        .that(await repo.reserveEmailSend(cert.id, { at, firstSendOnly: true }))
        .toEqual({ outcome: 'not_eligible' });
      clause(PORT, 'reserveEmailSend: without firstSendOnly keeps counting', 'resend')
        .that(await repo.reserveEmailSend(cert.id, { at, firstSendOnly: false }))
        .toEqual({ outcome: 'reserved', sequence: 2 });
      clause(PORT, 'reserveEmailSend: not_found for an unknown id', 'unknown')
        .that(
          await repo.reserveEmailSend(asCertificateId('z'.repeat(22)), { at, firstSendOnly: true }),
        )
        .toEqual({ outcome: 'not_found' });
    });

    test('reserveEmailSend firstSendOnly refuses skipped and revoked certificates', async (repo) => {
      const skipped = sampleCertificate({ emailStatus: 'skipped' });
      const revoked = sampleCertificate({
        email: 'a@example.com',
        emailStatus: 'pending',
        status: 'revoked',
      });
      await repo.createMany([skipped, revoked]);
      const at = new Date(BASE + 50_000);
      for (const c of [skipped, revoked]) {
        clause(PORT, 'reserveEmailSend: firstSendOnly needs active + pending', c.status)
          .that(await repo.reserveEmailSend(c.id, { at, firstSendOnly: true }))
          .toEqual({ outcome: 'not_eligible' });
      }
      clause(PORT, 'reserveEmailSend: not_eligible changes nothing', 'unchanged')
        .that(await repo.getById(skipped.id))
        .toEqual(skipped);
    });

    test('reserveEmailSend is atomic under concurrency', async (repo) => {
      const cert = sampleCertificate({ email: 'a@example.com', emailStatus: 'pending' });
      await repo.create(cert);
      const at = new Date(BASE + 50_000);
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          repo.reserveEmailSend(cert.id, { at, firstSendOnly: false }),
        ),
      );
      const sequences = results.map((r) => (r.outcome === 'reserved' ? r.sequence : -1));
      clause(PORT, 'reserveEmailSend: concurrent calls get distinct sequences', 'concurrent')
        .that([...sequences].sort((a, b) => a - b))
        .toEqual([1, 2, 3, 4, 5]);
    });

    test('countByTemplate / countByOrganization / countByEvent', async (repo) => {
      await repo.createMany([
        sampleCertificate(),
        sampleCertificate({ templateId: asTemplateRef('attendance-v2'), eventId: EVENT_2 }),
        sampleCertificate({ organizationId: ORG_2, templateId: asTemplateRef('attendance-v2') }),
      ]);
      clause(PORT, 'countByTemplate: certificates of one template reference', 'v1')
        .that(await repo.countByTemplate(asTemplateRef('attendance-v1')))
        .toBe(1);
      clause(PORT, 'countByTemplate: certificates of one template reference', 'v2')
        .that(await repo.countByTemplate(asTemplateRef('attendance-v2')))
        .toBe(2);
      clause(PORT, 'countByTemplate: zero for an unused reference', 'none')
        .that(await repo.countByTemplate(asTemplateRef('other-v1')))
        .toBe(0);
      clause(PORT, 'countByOrganization: certificates of one organization', 'org 1')
        .that(await repo.countByOrganization(ORG_1))
        .toBe(2);
      clause(PORT, 'countByEvent: certificates of one event', 'event 2')
        .that(await repo.countByEvent(EVENT_2))
        .toBe(1);
    });
  });
}
