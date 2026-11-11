// Architecture boundary rules (ports and adapters). See "Architecture boundaries" in README.md.
// Kept in its own file so that test/architecture can run exactly the same rules on fixtures.

/** Vendor SDKs and drivers: importable only under src/adapters/** and src/testing/**. */
const VENDOR_PACKAGES = [
  'firebase-admin',
  'firebase-admin/*',
  'firebase',
  'firebase/*',
  '@firebase/*',
  '@google-cloud/*',
  'googleapis',
  'google-auth-library',
  'nodemailer',
  'pg',
  'pg-*',
  'mysql',
  'mysql2',
  'mysql2/*',
  'mongodb',
  'mongoose',
  'redis',
  'ioredis',
  '@aws-sdk/*',
  'aws-sdk',
  '@azure/*',
  '@sendgrid/*',
  '@getbrevo/*',
  'sib-api-v3-sdk',
  'minio',
  'bullmq',
  'amqplib',
  'kafkajs',
  'knex',
  'typeorm',
  'sequelize',
  '@prisma/client',
];

const VENDOR_MESSAGE =
  'Vendor SDKs may only be imported under src/adapters/** or src/testing/**. ' +
  'Depend on a port from src/ports/** instead.';

const TESTING_MESSAGE =
  'src/testing/** (fakes and test helpers) must not be imported from production code. ' +
  'Only test/** may import it.';

const DOCUMENT_REFERENCE_MESSAGE =
  'DocumentReference is a Firestore type. Relations are plain string IDs; ' +
  'Firestore types may only appear under src/adapters/**.';

/** @param {string} s */
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

// Regex source matching an import specifier of any vendor package (and its subpaths).
const vendorSpecifier = `^(?:${VENDOR_PACKAGES.map((p) =>
  p.endsWith('/*') ? `${escapeRegExp(p.slice(0, -2))}\\/.+` : `${escapeRegExp(p)}(?:\\/.+)?`,
).join('|')})$`;

const vendorPatterns = [{ group: VENDOR_PACKAGES, message: VENDOR_MESSAGE }];
const testingPatterns = [{ group: ['**/testing', '**/testing/**'], message: TESTING_MESSAGE }];

const documentReference = {
  selector: 'Identifier[name="DocumentReference"]',
  message: DOCUMENT_REFERENCE_MESSAGE,
};

// no-restricted-imports does not see import() or require(), so cover them with selectors.
const dynamicVendorImports = [
  {
    selector: `ImportExpression[source.type="Literal"][source.value=/${vendorSpecifier}/]`,
    message: VENDOR_MESSAGE,
  },
  {
    selector: `CallExpression[callee.name="require"][arguments.0.type="Literal"][arguments.0.value=/${vendorSpecifier}/]`,
    message: VENDOR_MESSAGE,
  },
];

/** @param {{ group: string[]; message: string }[]} patterns */
const restrictImports = (patterns) => ['error', { patterns }];
/** @param {{ selector: string; message: string }[]} entries */
const restrictSyntax = (...entries) => ['error', ...entries];

/** Flat config blocks, to be spread into the main ESLint config. */
export const boundaryConfig = [
  {
    name: 'boundaries/production-code',
    files: ['src/**/*.ts'],
    ignores: ['src/adapters/**', 'src/testing/**'],
    rules: {
      'no-restricted-imports': restrictImports([...vendorPatterns, ...testingPatterns]),
      'no-restricted-syntax': restrictSyntax(documentReference, ...dynamicVendorImports),
    },
  },
  {
    name: 'boundaries/adapters',
    files: ['src/adapters/**/*.ts'],
    // The memory adapters are the in-memory fakes by design (BEU-ICT/certificate-manager#245).
    ignores: ['src/adapters/memory/**'],
    rules: {
      // Vendors and DocumentReference are fine here, test helpers are not.
      'no-restricted-imports': restrictImports(testingPatterns),
    },
  },
  {
    name: 'boundaries/testing-helpers',
    files: ['src/testing/**/*.ts'],
    rules: {
      // Vendors are allowed (emulator helpers), but relations are still plain string IDs.
      'no-restricted-syntax': restrictSyntax(documentReference),
    },
  },
  {
    name: 'boundaries/tests',
    files: ['test/**/*.ts'],
    // Integration tests run against emulators and may use SDKs; architecture tests inspect fixtures.
    ignores: ['test/integration/**', 'test/architecture/**'],
    rules: {
      'no-restricted-imports': restrictImports(vendorPatterns),
      'no-restricted-syntax': restrictSyntax(documentReference, ...dynamicVendorImports),
    },
  },
];
