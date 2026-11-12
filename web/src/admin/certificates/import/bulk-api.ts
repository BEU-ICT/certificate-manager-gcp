import { api } from '@/api';
import type { operations } from '@/api/schema';

type BulkOperation = operations['issueCertificatesBulk'];
export type BulkBody = BulkOperation['requestBody']['content']['application/json'];
export type BulkResponse = BulkOperation['responses'][201]['content']['application/json'];

/** `{ ownerName, email?, subject?, skills?, issuedAt? }`; the generated type leaves items open. */
export interface BulkItem {
  ownerName: string;
  email?: string;
  subject?: string;
  skills?: string[];
  issuedAt?: string;
}

export interface BulkResult extends BulkResponse {
  /** `Idempotent-Replayed: true`: the chunk had been created by an earlier attempt. */
  replayed: boolean;
}

/** `POST /admin/certificates/bulk` with an `Idempotency-Key`; all or nothing for up to 500 items. */
export async function postBulkChunk(
  body: BulkBody,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<BulkResult> {
  let replayed = false;
  const response = await api().post<BulkResponse>('/admin/certificates/bulk', body, {
    headers: { 'Idempotency-Key': idempotencyKey },
    signal,
    timeoutMs: 60_000,
    onResponse: (r) => {
      replayed = r.headers.get('Idempotent-Replayed') === 'true';
    },
  });
  return { ...response, replayed };
}
