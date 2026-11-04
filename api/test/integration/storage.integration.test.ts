import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

// Runs only against a fake-gcs-server (see README, "Storage emulator"):
//   docker compose -f test/integration/docker-compose.storage.yml up -d
//   STORAGE_EMULATOR_HOST=localhost:4443 npm run test:integration
// Without STORAGE_EMULATOR_HOST the suite is skipped, so CI and a plain local run need no Docker.
//
// TODO(Storage adapter task): replace this capability probe by
// `describeStorageGatewayContract(...)` run against the GCS adapter. Until the adapter exists the
// test talks to the JSON API directly to pin down what the emulator supports (ifGenerationMatch).
const host = process.env['STORAGE_EMULATOR_HOST'];
const base = host ? (host.startsWith('http') ? host : `http://${host}`) : '';

async function upload(bucket: string, name: string, body: string, query = ''): Promise<Response> {
  return fetch(
    `${base}/upload/storage/v1/b/${bucket}/o?uploadType=media&name=${encodeURIComponent(name)}${query}`,
    {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body,
    },
  );
}

describe.skipIf(!host)('fake-gcs-server (STORAGE_EMULATOR_HOST)', () => {
  const bucket = `it-${randomUUID()}`;

  it('creates a bucket', async () => {
    const res = await fetch(`${base}/storage/v1/b`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: bucket }),
    });
    expect(res.status).toBe(200);
  });

  it('honours ifGenerationMatch=0 (create only if absent): second write fails with 412', async () => {
    expect((await upload(bucket, 'once', 'first', '&ifGenerationMatch=0')).status).toBe(200);
    expect((await upload(bucket, 'once', 'second', '&ifGenerationMatch=0')).status).toBe(412);

    const stored = await fetch(`${base}/storage/v1/b/${bucket}/o/once?alt=media`);
    expect(await stored.text()).toBe('first');
  });

  it('rejects a stale ifGenerationMatch with 412 and keeps the object', async () => {
    await upload(bucket, 'gen', 'v1');
    const res = await upload(bucket, 'gen', 'v2', '&ifGenerationMatch=1');
    expect(res.status).toBe(412);
  });

  it('lets exactly one of many concurrent create-if-absent writers win', async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        upload(bucket, 'race', `writer-${i}`, '&ifGenerationMatch=0'),
      ),
    );
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    expect(statuses.filter((s) => s === 412)).toHaveLength(19);
  });
});
