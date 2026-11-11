import { randomUUID } from 'node:crypto';
import { buildApp } from './app.js';
import { AdapterError, compose, type Composition } from './compose.js';
import { ConfigError, loadConfig, type Config } from './config.js';
import { createFeatureFlags } from './flags.js';
import { migrationSettings, runMigrationsWithPorts } from './migrations/index.js';
import {
  SERVICE_NAME,
  logUnexpectedError,
  serviceVersion,
} from './http/logging/error-reporting.js';
import { installProcessSafety } from './process-safety.js';
import { shutdown } from './shutdown.js';

// Composition root: the only module that reads process.env.
let config: Config;
try {
  config = loadConfig(process.env);
} catch (err) {
  // Print every violation (names and reasons only, never values) and stop before listening.
  process.stderr.write(`${err instanceof ConfigError ? err.message : String(err)}\n`);
  process.exit(1);
}

let composition: Composition;
try {
  composition = await compose(config, undefined, process.env);
} catch (err) {
  // Unknown or unavailable adapter: print the reason without a stack trace and stop.
  process.stderr.write(`${err instanceof AdapterError ? err.message : String(err)}\n`);
  process.exit(1);
}

const version = serviceVersion(process.env);

const app = buildApp({
  log: {
    level: config.logLevel,
    gcpProject: config.gcpProject,
    serviceContext: { service: SERVICE_NAME, version },
  },
  ports: composition.ports,
  services: composition.services,
  sendEmail: composition.sendEmail,
  openApiEndpoint: config.flags.openApiEndpoint,
  flags: createFeatureFlags(config.flags),
  adminRateLimitPerMin: config.rateLimit.adminPerMin,
  publicUrls: { publicBaseUrl: config.publicBaseUrl, pdfPublicBaseUrl: config.pdfPublicBaseUrl },
});

installProcessSafety(process, app.log, { revision: process.env['K_REVISION'] ?? version });

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    void shutdown(app).then(
      () => process.exit(0),
      (err: unknown) => {
        app.log.error(err, 'shutdown failed');
        process.exit(1);
      },
    );
  });
}

// Pending data migrations run before the first request; a failure stops startup (exit 1) so that
// Cloud Run restarts the instance and the migration is retried.
try {
  const instanceId = `${process.env['K_REVISION'] ?? 'local'}-${randomUUID()}`;
  await runMigrationsWithPorts(composition.ports, app.log, instanceId, migrationSettings(config));
} catch (err) {
  logUnexpectedError(app.log, err, { revision: version, failure: 'migrations failed' });
  process.exit(1);
}

try {
  await app.listen({ host: '0.0.0.0', port: config.port });
} catch (err) {
  logUnexpectedError(app.log, err, { revision: version, failure: 'failed to start' });
  process.exit(1);
}
