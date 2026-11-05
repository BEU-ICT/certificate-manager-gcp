import type { Certificate, EmailStatus } from '../../shared/domain.js';

export function isRevoked(certificate: Pick<Certificate, 'status'>): boolean {
  return certificate.status === 'revoked';
}

/** A certificate with an e-mail address is queued for delivery; without one it is skipped. */
export function emailInitialStatus(certificate: Pick<Certificate, 'email'>): EmailStatus {
  return certificate.email ? 'pending' : 'skipped';
}
