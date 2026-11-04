import type { CertificateId } from '../shared/ids.js';

export interface IdGenerator {
  /** 22-char base64url from 16 random bytes. */
  newCertificateId(): CertificateId;
  /** 22-char base64url from 16 random bytes: id of organizations, events and other entities. */
  newEntityId(): string;
  /** Unguessable URL-safe token (e.g. for unsubscribe/verification links). */
  newToken(): string;
}
