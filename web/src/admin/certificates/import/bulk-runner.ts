import { isApiError, type ApiError } from '@/api';
import type { BulkResult } from './bulk-api';

/** Waits and limits; tests set the delays to 0. */
export const runnerTuning = {
  /** Retries of one chunk after a network error, always with the same key. */
  maxNetworkRetries: 3,
  /** Consecutive 429 answers waited out for one chunk before the run stops. */
  maxRateLimitWaits: 10,
  networkBackoffMs: 1_000,
  defaultRetryAfterSeconds: 5,
};

export interface PlannedChunk<R> {
  /** Position in the whole import; part of the idempotency key. */
  index: number;
  rows: readonly R[];
}

export type ChunkPhase = 'running' | 'waiting' | 'retrying' | 'done' | 'failed';

export interface ChunkUpdate {
  index: number;
  phase: ChunkPhase;
  /** Seconds to wait (`waiting`) or the retry number (`retrying`). */
  value?: number;
  result?: BulkResult;
  error?: ApiError;
}

export interface RunDeps<R> {
  send: (chunk: PlannedChunk<R>, signal: AbortSignal) => Promise<BulkResult>;
  onUpdate: (update: ChunkUpdate) => void;
  signal: AbortSignal;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

export type RunOutcome =
  { ok: true } | { ok: false; index: number; error: ApiError | undefined; aborted: boolean };

export function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted || ms <= 0) {
      resolve();
      return;
    }
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
  });
}

const retriable = (error: ApiError): boolean =>
  error.status === 0 || (error.status === 409 && error.code === 'REQUEST_IN_PROGRESS');

/**
 * Sends the chunks one after the other and stops at the first one that fails. A 429 waits for
 * `Retry-After` and sends again; a network error (or a request still in progress) is retried with
 * the same key up to `maxNetworkRetries` times.
 */
export async function runChunks<R>(
  chunks: readonly PlannedChunk<R>[],
  deps: RunDeps<R>,
): Promise<RunOutcome> {
  const sleep = deps.sleep ?? defaultSleep;
  for (const chunk of chunks) {
    let networkRetries = 0;
    let rateWaits = 0;
    for (;;) {
      if (deps.signal.aborted)
        return { ok: false, index: chunk.index, error: undefined, aborted: true };
      deps.onUpdate({ index: chunk.index, phase: 'running' });
      try {
        const result = await deps.send(chunk, deps.signal);
        deps.onUpdate({ index: chunk.index, phase: 'done', result });
        break;
      } catch (error) {
        if (deps.signal.aborted)
          return { ok: false, index: chunk.index, error: undefined, aborted: true };
        if (!isApiError(error)) {
          deps.onUpdate({ index: chunk.index, phase: 'failed' });
          return { ok: false, index: chunk.index, error: undefined, aborted: false };
        }
        if (error.status === 429 && rateWaits < runnerTuning.maxRateLimitWaits) {
          rateWaits += 1;
          const seconds = error.retryAfterSeconds ?? runnerTuning.defaultRetryAfterSeconds;
          deps.onUpdate({ index: chunk.index, phase: 'waiting', value: seconds });
          await sleep(seconds * 1000, deps.signal);
          continue;
        }
        if (retriable(error) && networkRetries < runnerTuning.maxNetworkRetries) {
          networkRetries += 1;
          deps.onUpdate({ index: chunk.index, phase: 'retrying', value: networkRetries });
          await sleep(runnerTuning.networkBackoffMs * networkRetries, deps.signal);
          continue;
        }
        deps.onUpdate({ index: chunk.index, phase: 'failed', error });
        return { ok: false, index: chunk.index, error, aborted: false };
      }
    }
  }
  return { ok: true };
}
