/// <reference lib="webworker" />
import { parseFileContent } from './parse';
import type { ParseOptions, ParseOutcome } from './types';

export interface WorkerRequest {
  name: string;
  size: number;
  buffer: ArrayBuffer;
  options: ParseOptions;
}
export type WorkerResponse = ParseOutcome;

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const { name, size, buffer, options } = event.data;
  void parseFileContent({ name, size }, buffer, options).then(
    (outcome) => self.postMessage(outcome satisfies WorkerResponse),
    () => self.postMessage({ ok: false, error: { code: 'invalidFile' } } satisfies WorkerResponse),
  );
};
