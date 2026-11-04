import type { IdGenerator } from '../../ports/index.js';
import { asCertificateId, type CertificateId } from '../../shared/ids.js';

/**
 * Deterministic IDs: `queue*` supplies the next values explicitly, otherwise
 * a counter yields `cert-0000000000000001`-style (22 chars) IDs and `token-1` tokens.
 */
export class FakeIdGenerator implements IdGenerator {
  private certificateCounter = 0;
  private tokenCounter = 0;
  private entityCounter = 0;
  private readonly entityQueue: string[] = [];
  private readonly certificateQueue: string[] = [];
  private readonly tokenQueue: string[] = [];

  queueCertificateIds(...ids: string[]): void {
    this.certificateQueue.push(...ids);
  }

  queueTokens(...tokens: string[]): void {
    this.tokenQueue.push(...tokens);
  }

  newCertificateId(): CertificateId {
    const queued = this.certificateQueue.shift();
    if (queued !== undefined) return asCertificateId(queued);
    this.certificateCounter += 1;
    return asCertificateId(`cert-${String(this.certificateCounter).padStart(17, '0')}`);
  }

  queueEntityIds(...ids: string[]): void {
    this.entityQueue.push(...ids);
  }

  newEntityId(): string {
    const queued = this.entityQueue.shift();
    if (queued !== undefined) return queued;
    this.entityCounter += 1;
    return `ent-${String(this.entityCounter).padStart(18, '0')}`;
  }

  newToken(): string {
    const queued = this.tokenQueue.shift();
    if (queued !== undefined) return queued;
    this.tokenCounter += 1;
    return `token-${this.tokenCounter}`;
  }
}
