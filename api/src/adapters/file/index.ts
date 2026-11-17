import path from 'node:path';
import { createLogger } from '../../http/logging/logger.js';
import type { EmailSender } from '../../ports/index.js';
import { AdapterError, type AdapterContext } from '../registry.js';
import { FileEmailSender } from './file-email-sender.js';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** True when nothing in the configuration points at a deployed environment. */
export function looksLocal(config: AdapterContext['config']): boolean {
  if (config.env === 'production') return false;
  if (!config.gcpProject.startsWith('demo-')) return false;
  return [config.serviceUrl, config.publicBaseUrl, config.pdfPublicBaseUrl].every((u) => {
    try {
      const { hostname } = new URL(u);
      return LOCAL_HOSTS.has(hostname) || hostname.endsWith('.localhost');
    } catch {
      return false;
    }
  });
}

/**
 * `EMAIL_PROVIDER=file` / `EMAIL_FALLBACK_PROVIDER=file`: local development only. Refused when
 * NODE_ENV=production or when the project id or URLs look like a deployed environment.
 */
export function createEmailSender({ config }: AdapterContext): EmailSender {
  if (!looksLocal(config)) {
    throw new AdapterError('EMAIL_PROVIDER: adapter "file" is local-only and not available here');
  }
  const logger = createLogger({ level: config.logLevel, gcpProject: config.gcpProject });
  return new FileEmailSender({
    dir: path.resolve(config.email.fileDir),
    log: (line) => logger.info(line),
  });
}
