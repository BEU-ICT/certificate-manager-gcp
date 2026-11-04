import { buildApp } from './app.js';
import { ConfigError, loadConfig, type Config } from './config.js';
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

const app = buildApp({ logger: true });

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

try {
  await app.listen({ host: '0.0.0.0', port: config.port });
} catch (err) {
  app.log.error(err, 'failed to start');
  process.exit(1);
}
