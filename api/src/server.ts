import { randomUUID } from 'node:crypto';
import { buildApp } from './app.js';
import { AdapterError, compose, type Composition } from './compose.js';
import { ConfigError, loadConfig, type Config } from './config.js';
import { runMigrationsWithPorts } from './migrations/index.js';
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

const app = buildApp({
  log: { level: config.logLevel, gcpProject: config.gcpProject },
  ports: composition.ports,
  services: composition.services,
});

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
  await runMigrationsWithPorts(composition.ports, app.log, instanceId);
} catch (err) {
  app.log.error(err, 'migrations failed');
  process.exit(1);
}

try {
  await app.listen({ host: '0.0.0.0', port: config.port });
} catch (err) {
  app.log.error(err, 'failed to start');
  process.exit(1);
}
