import { buildApp } from './app.js';
import { shutdown } from './shutdown.js';

// Composition root: the only module that reads process.env.
const port = Number(process.env['PORT'] ?? 8080);

const app = buildApp({
  log: { level: process.env['LOG_LEVEL'], gcpProject: process.env['GCP_PROJECT'] },
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

try {
  await app.listen({ host: '0.0.0.0', port });
} catch (err) {
  app.log.error(err, 'failed to start');
  process.exit(1);
}
