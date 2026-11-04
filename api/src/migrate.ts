import { randomUUID } from 'node:crypto';
import { AdapterError, compose } from './compose.js';
import { ConfigError, loadConfig } from './config.js';
import { createLogger } from './http/logging/logger.js';
import { runMigrationsWithPorts } from './migrations/index.js';

/**
 * `npm run migrate`: runs pending migrations against the configured database and exits.
 * Uses the same environment variables as the server, so point it at the target project
 * (or the emulator) before running.
 */
try {
  const config = loadConfig(process.env);
  const { ports } = await compose(config, undefined, process.env);
  const log = createLogger({ level: config.logLevel, gcpProject: config.gcpProject });
  const report = await runMigrationsWithPorts(ports, log, `cli-${randomUUID()}`);
  log.info({ applied: report.applied, skipped: report.skipped }, 'migrations finished');
  process.exit(0);
} catch (err) {
  const known = err instanceof ConfigError || err instanceof AdapterError;
  process.stderr.write(`${known ? err.message : String(err)}\n`);
  process.exit(1);
}
