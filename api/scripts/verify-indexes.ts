/**
 * Runs all 63 non-empty combinations of the six certificate list filters (organization, event,
 * type, status, emailStatus, issuedAt range) through the real repository against a real Firestore
 * database and fails on FAILED_PRECONDITION (missing composite index). The emulator does not
 * validate indexes, so this runs manually against the real database before go-live (#203).
 *
 *   GOOGLE_CLOUD_PROJECT=<project> npx tsx scripts/verify-indexes.ts --yes
 *
 * It writes a tiny dataset with ids prefixed `verify-idx-` into the `certificates` collection and
 * deletes it afterwards. Use ADC credentials with access to that project; nothing else is touched.
 */
import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldPath, getFirestore } from 'firebase-admin/firestore';
import { FirestoreCertificateRepository } from '../src/adapters/firestore/certificate-repository.js';
import type { CertificateFilter } from '../src/ports/index.js';
import type { Certificate } from '../src/shared/domain.js';
import { asCertificateId, asEventId, asOrganizationId, asTemplateRef } from '../src/shared/ids.js';

const FAILED_PRECONDITION = 9;
const project = process.env['GOOGLE_CLOUD_PROJECT'] ?? process.env['GCLOUD_PROJECT'];
if (!project) throw new Error('Set GOOGLE_CLOUD_PROJECT to the project to verify.');
if (!process.argv.includes('--yes')) {
  throw new Error(`Refusing to write test documents to "${project}" without --yes.`);
}

const app = getApps()[0] ?? initializeApp({ projectId: project });
const db = getFirestore(app);
const repo = new FirestoreCertificateRepository(db);

const ORG = asOrganizationId('verify-idx-org');
const EVENT = asEventId('verify-idx-event');
const base = Date.UTC(2026, 0, 1);

const dataset: Certificate[] = Array.from({ length: 6 }, (_, i) => ({
  id: asCertificateId(`verify-idx-${String(i).padStart(11, '0')}`.slice(0, 22).padEnd(22, '0')),
  organizationId: ORG,
  eventId: EVENT,
  organizationName: 'Verify',
  eventName: 'Verify',
  templateId: asTemplateRef('verify-v1'),
  type: i % 2 === 0 ? 'attendance' : 'thanks',
  ownerName: 'Verify',
  subject: 'Verify',
  skills: [],
  status: i % 3 === 0 ? 'revoked' : 'active',
  issuedAt: new Date(base + i * 86_400_000),
  emailStatus: i % 2 === 0 ? 'skipped' : 'sent',
  emailAttempts: 0,
  createdBy: 'verify-indexes',
  createdAt: new Date(base),
  updatedAt: new Date(base),
  schemaVersion: 1,
}));

const FACETS = ['organizationId', 'eventId', 'type', 'status', 'emailStatus', 'issuedAt'] as const;

function filterFor(mask: number): CertificateFilter {
  const f: CertificateFilter = {
    ...(mask & 1 && { organizationId: ORG }),
    ...(mask & 2 && { eventId: EVENT }),
    ...(mask & 4 && { type: 'attendance' as const }),
    ...(mask & 8 && { status: 'active' as const }),
    ...(mask & 16 && { emailStatus: 'skipped' as const }),
    ...(mask & 32 && { issuedFrom: new Date(base), issuedTo: new Date(base + 10 * 86_400_000) }),
  };
  return f;
}

const label = (mask: number) => FACETS.filter((_, i) => mask & (1 << i)).join(' + ');

async function main(): Promise<void> {
  // Remove leftovers of an earlier aborted run so createMany does not collide.
  const leftovers = await db
    .collection('certificates')
    .where(FieldPath.documentId(), '>=', 'verify-idx-')
    .where(FieldPath.documentId(), '<', 'verify-idx.')
    .get();
  await Promise.all(leftovers.docs.map((d) => d.ref.delete()));
  await repo.createMany(dataset);
  const failures: string[] = [];
  let checked = 0;
  try {
    for (let mask = 1; mask < 64; mask++) {
      const filter = filterFor(mask);
      try {
        await repo.list(filter, { limit: 2 });
        await repo.count(filter);
        checked += 1;
      } catch (error) {
        const code = (error as { code?: unknown }).code;
        failures.push(
          `${label(mask)}: ${code === FAILED_PRECONDITION ? 'FAILED_PRECONDITION (missing index)' : String(error)}`,
        );
      }
    }
  } finally {
    await Promise.all(dataset.map((c) => db.collection('certificates').doc(c.id).delete()));
  }
  console.log(`${String(checked)}/63 filter combinations OK`);
  if (failures.length > 0) {
    console.error(failures.join('\n'));
    process.exitCode = 1;
  }
}

await main();
