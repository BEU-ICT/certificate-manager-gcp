/**
 * `npm run seed:dev`: fills the local Firebase emulators with demo data (BEU-ICT/certificate-manager#280).
 *
 * Creates an administrator in the Auth emulator and, in the Firestore emulator, one organization,
 * one event, one template package and a few certificates (active and revoked, with and without
 * e-mail). Safe to run twice: existing records are reused. It refuses to run unless the project id
 * is an emulator project (`demo-` prefix) and both emulator hosts are local, so it can never touch
 * production. Start the emulators first (`npm run dev:emulators`).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { compose } from '../api/src/compose.js';
import { loadConfig } from '../api/src/config.js';
import { checkTemplateUpload, type TemplateFile } from '../api/src/modules/templates/index.js';
import { SCHEMA_VERSION } from '../api/src/shared/schema-version.js';
import type { Certificate } from '../api/src/shared/domain.js';
import type { CertificateType } from '../api/src/shared/certificate-types.js';

const ADMIN_EMAIL = process.env['SEED_ADMIN_EMAIL'] ?? 'admin@example.test';
/** Emulator-only value; it is accepted by no real Firebase project. */
const ADMIN_PASSWORD = process.env['SEED_ADMIN_PASSWORD'] ?? 'local-admin-password';
const ORG_NAME = 'Demo Organization';
const EVENT_NAME = 'Demo Event 2026';
const TEMPLATE_TYPE: CertificateType = 'attendance';
const TEMPLATE_DIR = resolve(__dirname, '../api/test/fixtures/templates/good');

function fail(message: string): never {
  process.stderr.write(`seed-dev: ${message}\n`);
  process.exit(1);
}

const isLocal = (host: string | undefined): host is string =>
  host !== undefined && /^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(host);

// Emulator hosts default to the ones in firebase.json; anything else is refused.
const env: Record<string, string | undefined> = {
  ...process.env,
  NODE_ENV: 'development',
  GCP_PROJECT: process.env['GCP_PROJECT'] ?? 'demo-certificate-manager',
  FIRESTORE_EMULATOR_HOST: process.env['FIRESTORE_EMULATOR_HOST'] ?? '127.0.0.1:8081',
  FIREBASE_AUTH_EMULATOR_HOST: process.env['FIREBASE_AUTH_EMULATOR_HOST'] ?? '127.0.0.1:9099',
  DB_ADAPTER: 'firestore',
  LOG_LEVEL: process.env['LOG_LEVEL'] ?? 'warn',
};
if (!env['GCP_PROJECT']?.startsWith('demo-')) {
  fail(
    `GCP_PROJECT "${env['GCP_PROJECT'] ?? ''}" is not an emulator project (must start with "demo-"); refusing to run.`,
  );
}
if (!isLocal(env['FIRESTORE_EMULATOR_HOST']) || !isLocal(env['FIREBASE_AUTH_EMULATOR_HOST'])) {
  fail(
    'FIRESTORE_EMULATOR_HOST and FIREBASE_AUTH_EMULATOR_HOST must point to localhost; refusing to run.',
  );
}
// The Admin SDK reads these from process.env.
process.env['FIRESTORE_EMULATOR_HOST'] = env['FIRESTORE_EMULATOR_HOST'];
process.env['FIREBASE_AUTH_EMULATOR_HOST'] = env['FIREBASE_AUTH_EMULATOR_HOST'];

function readPackage(dir: string): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  const walk = (current: string): void => {
    for (const name of readdirSync(current)) {
      const path = join(current, name);
      if (statSync(path).isDirectory()) walk(path);
      else files.set(relative(dir, path).split('\\').join('/'), readFileSync(path));
    }
  };
  walk(dir);
  return files;
}

async function seedAdmin(projectId: string): Promise<string> {
  const app =
    getApps().find((a) => a.name === 'seed-dev') ?? initializeApp({ projectId }, 'seed-dev');
  const auth = getAuth(app);
  let uid: string;
  try {
    uid = (await auth.getUserByEmail(ADMIN_EMAIL)).uid;
    await auth.updateUser(uid, { password: ADMIN_PASSWORD, emailVerified: true });
  } catch (error) {
    if ((error as { code?: string }).code !== 'auth/user-not-found') throw error;
    uid = (
      await auth.createUser({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD, emailVerified: true })
    ).uid;
  }
  await auth.setCustomUserClaims(uid, { role: 'admin' });
  return uid;
}

async function main(): Promise<void> {
  const config = loadConfig(env);
  const adminUid = await seedAdmin(config.gcpProject);
  const { ports, services } = await compose(config, undefined, env);

  const organization =
    (await ports.organizations.getBySlug('demo-organization')) ??
    (await services.organizations.create({ name: ORG_NAME, slug: 'demo-organization' }));
  const event =
    (await ports.events.getBySlug(organization.id, 'demo-event-2026')) ??
    (await services.events.create({
      organizationId: organization.id,
      name: EVENT_NAME,
      slug: 'demo-event-2026',
    }));

  const target = {
    organizationId: organization.id,
    eventId: event.id,
    organizationSlug: organization.slug,
    eventSlug: event.slug,
    type: TEMPLATE_TYPE,
  };
  let template = await services.templates.getLatest(organization.id, event.id, TEMPLATE_TYPE);
  let templateCreated = false;
  if (!template) {
    const files = readPackage(TEMPLATE_DIR);
    const configJson: unknown = JSON.parse(
      (files.get('config.json') ?? fail('fixture config.json missing')).toString('utf8'),
    );
    files.delete('config.json');
    const checked = checkTemplateUpload(configJson, files);
    const templateFiles: TemplateFile[] = [...files].map(([path, body]) => ({ path, body }));
    template = await services.templates.publish({
      ...target,
      config: checked.config,
      files: templateFiles,
      createdBy: adminUid,
    });
    templateCreated = true;
  }

  // Certificates only on the first run: they are not looked up by content.
  let certificateCount = 0;
  const existing = await services.certificateQueries.count({ eventId: event.id });
  if (existing === 0) {
    const now = new Date();
    const make = (
      ownerName: string,
      subject: string,
      email: string | undefined,
      daysAgo: number,
    ): Certificate => ({
      id: ports.ids.newCertificateId(),
      organizationId: organization.id,
      eventId: event.id,
      organizationName: organization.name,
      eventName: event.name,
      templateId: template.reference,
      type: TEMPLATE_TYPE,
      ownerName,
      ...(email !== undefined && { email }),
      subject,
      skills: ['Teamwork', 'Communication'],
      status: 'active',
      issuedAt: new Date(now.getTime() - daysAgo * 86_400_000),
      emailStatus: email === undefined ? 'skipped' : 'pending',
      emailAttempts: 0,
      createdBy: adminUid,
      createdAt: now,
      updatedAt: now,
      schemaVersion: SCHEMA_VERSION,
    });
    const certificates = [
      make('Aysel Məmmədova', 'Participation in the Demo Event', 'aysel@example.test', 3),
      make('Rəşad Əliyev', 'Participation in the Demo Event', undefined, 2),
      make('Leyla Həsənova', 'Participation in the Demo Event', 'leyla@example.test', 1),
    ];
    await ports.certificates.createMany(certificates);
    certificateCount = certificates.length;
    const revoked = certificates[2];
    if (revoked) await services.revocation.revoke(revoked.id, 'Issued by mistake (seed data)');
  }

  const lines = [
    '',
    'Seeded the local emulators (project ' + config.gcpProject + '):',
    `  admin         ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}   (emulator only)`,
    `  organization  ${organization.name} (${organization.id})`,
    `  event         ${event.name} (${event.id})`,
    `  template      ${template.reference}${templateCreated ? '' : ' (existing)'}`,
    `  certificates  ${certificateCount > 0 ? `${String(certificateCount)} created (1 revoked, 1 without e-mail)` : 'already present'}`,
  ];
  if (config.adapters.storage === 'memory' && templateCreated) {
    lines.push(
      '',
      'Note: STORAGE_ADAPTER=memory, so the template package files were not kept after this script exited;',
      'the template document exists, the stored files will appear once a persistent storage adapter is available.',
    );
  }
  process.stdout.write(`${lines.join('\n')}\n`);
}

main().then(
  () => process.exit(0),
  (error: unknown) => fail(error instanceof Error ? (error.stack ?? error.message) : String(error)),
);
