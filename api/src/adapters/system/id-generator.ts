import { randomBytes } from 'node:crypto';
import type { IdGenerator } from '../../ports/index.js';
import { asCertificateId, type CertificateId } from '../../shared/ids.js';

export class RandomIdGenerator implements IdGenerator {
  newCertificateId(): CertificateId {
    return asCertificateId(randomBytes(16).toString('base64url'));
  }

  newEntityId(): string {
    return randomBytes(16).toString('base64url');
  }

  newToken(): string {
    return randomBytes(32).toString('base64url');
  }
}
