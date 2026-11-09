import { WORKER_THRESHOLD_BYTES } from './limits';
import { checkFile, parseFileContent } from './parse';
import type { WorkerRequest } from './worker';
import type { ParseOptions, ParseOutcome } from './types';

export * from './headers';
export * from './limits';
export * from './template';
export type * from './types';
export type { RowErrorCode } from './schemas';
export { FIELD_LIMITS } from './schemas';

function parseInWorker(
  file: File,
  buffer: ArrayBuffer,
  options: ParseOptions,
): Promise<ParseOutcome> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    const done = () => worker.terminate();
    worker.onmessage = (event: MessageEvent<ParseOutcome>) => {
      done();
      resolve(event.data);
    };
    worker.onerror = (event) => {
      done();
      reject(new Error(event.message));
    };
    const request: WorkerRequest = { name: file.name, size: file.size, buffer, options };
    worker.postMessage(request, [buffer]);
  });
}

/**
 * Reads and validates an import file (`.xlsx` first sheet, or `.csv`). Nothing leaves the
 * browser. Limits on type and size are checked before the file is read; files above 1 MB are
 * parsed in a Web Worker when the browser supports it.
 */
export async function parseCertificateFile(
  file: File,
  options: ParseOptions = {},
): Promise<ParseOutcome> {
  const problem = checkFile(file);
  if (problem) return { ok: false, error: problem };
  const buffer = await file.arrayBuffer();
  if (file.size > WORKER_THRESHOLD_BYTES && typeof Worker !== 'undefined') {
    try {
      return await parseInWorker(file, buffer, options);
    } catch {
      // The worker failed to start (for example blocked by CSP): the buffer was transferred,
      // so read the file again and parse on the main thread.
      return parseFileContent(file, await file.arrayBuffer(), options);
    }
  }
  return parseFileContent(file, buffer, options);
}
