import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { createLogger } from '../../src/http/logging/logger.js';
import { serviceVersion } from '../../src/http/logging/error-reporting.js';
import { installProcessSafety } from '../../src/process-safety.js';
import { captureLogs } from '../helpers/log-capture.js';

function setup() {
  const logs = captureLogs();
  const log = createLogger({
    destination: logs.stream,
    serviceContext: { service: 'certificates-api', version: 'rev-1' },
  });
  const proc = new EventEmitter();
  const exit = vi.fn();
  installProcessSafety(proc, log, { revision: 'rev-1', exit });
  return { logs, proc, exit };
}

describe('process safety', () => {
  it.each(['unhandledRejection', 'uncaughtException'])(
    'logs %s as CRITICAL with the revision and exits with 1',
    (event) => {
      const { logs, proc, exit } = setup();
      proc.emit(event, new Error('kaboom'));
      const [entry] = logs.lines();
      expect(entry).toMatchObject({
        severity: 'CRITICAL',
        '@type': expect.stringContaining('ReportedErrorEvent') as string,
        origin: event,
        revision: 'rev-1',
        serviceContext: { service: 'certificates-api', version: 'rev-1' },
      });
      expect(entry?.['message']).toContain('Error: kaboom');
      expect(exit).toHaveBeenCalledWith(1);
    },
  );

  it('handles non-Error rejections and only the first crash', () => {
    const { logs, proc, exit } = setup();
    proc.emit('unhandledRejection', 'plain string');
    proc.emit('uncaughtException', new Error('second'));
    expect(logs.lines()).toHaveLength(1);
    expect(logs.lines()[0]?.['message']).toContain('plain string');
    expect(exit).toHaveBeenCalledTimes(1);
  });
});

describe('serviceVersion', () => {
  it('prefers GIT_SHA, then K_REVISION, then unknown', () => {
    expect(serviceVersion({ GIT_SHA: 'abc', K_REVISION: 'rev-7' })).toBe('abc');
    expect(serviceVersion({ K_REVISION: 'rev-7' })).toBe('rev-7');
    expect(serviceVersion({})).toBe('unknown');
  });
});
