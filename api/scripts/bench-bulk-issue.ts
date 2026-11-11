// Bulk issuance benchmark (`npm run bench:bulk -w @certificate-manager/api`).
// Issues 500 items through DefaultCertificateIssuanceService on in-memory fakes with a no-op
// FitChecker and prints the elapsed time and RSS. It measures validation, normalisation, building,
// the atomic create and the 500 events only: not Firestore latency and not the real text fitting.
// The 10 s budget on a 512 MiB / 1 vCPU container (BEU-ICT/certificate-manager#340) must be
// measured on that container with the real PdfService; this script does not prove it.
import { performance } from 'node:perf_hooks';
import { DefaultCertificateIssuanceService } from '../src/modules/certificates/index.js';
import { buildServices } from '../src/services.js';
import { sampleEvent, sampleOrganization, sampleTemplate } from '../src/testing/contracts/index.js';
import { createFakes } from '../src/testing/fakes/index.js';

const ITEMS = 500;
const fakes = createFakes();
const org = sampleOrganization();
const event = sampleEvent({ organizationId: org.id });
const template = sampleTemplate({ organizationId: org.id, eventId: event.id });
await fakes.organizations.create(org);
await fakes.events.create(event);
await fakes.templates.create(template);
const fitChecker = { checkFit: () => Promise.resolve({ fits: true, issues: [] }) };
const { issuance } = buildServices(fakes, undefined, { fitChecker });
if (!(issuance instanceof DefaultCertificateIssuanceService)) throw new Error('no issuance');

const items = Array.from({ length: ITEMS }, (_v, i) => ({
  ownerName: `Person ${String(i)}`,
  email: `person${String(i)}@example.com`,
  skills: ['Cloud', 'Go'],
}));
const started = performance.now();
const created = await issuance.issueMany(
  {
    organizationId: org.id,
    eventId: event.id,
    type: template.type,
    subject: 'Cloud workshop',
    items,
  },
  'bench-admin',
);
const elapsed = performance.now() - started;
process.stdout.write(
  `issued ${String(created.length)} in ${elapsed.toFixed(0)} ms, rss ${String(Math.round(process.memoryUsage.rss() / 1024 / 1024))} MiB (in-memory fakes, no-op fit check)\n`,
);
