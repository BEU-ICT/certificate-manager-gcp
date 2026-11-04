import { randomUUID } from 'node:crypto';

const TRACE_HEADER = /^([0-9a-f]{32})(?:\/\d+)?(?:;o=\d)?$/i;

/** Trace ID from `X-Cloud-Trace-Context: TRACE_ID/SPAN_ID;o=TRACE_TRUE`, if well-formed. */
export function parseTraceId(header: string | string[] | undefined): string | undefined {
  if (typeof header !== 'string') return undefined;
  return TRACE_HEADER.exec(header.trim())?.[1]?.toLowerCase();
}

/** Request ID: the trace part when present, otherwise a fresh UUID. */
export function requestIdFrom(header: string | string[] | undefined): string {
  return parseTraceId(header) ?? randomUUID();
}

/** Value of the `logging.googleapis.com/trace` log field. */
export function traceField(gcpProject: string, traceId: string): string {
  return `projects/${gcpProject}/traces/${traceId}`;
}
