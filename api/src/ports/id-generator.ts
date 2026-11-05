import type { CertificateId } from '../shared/ids.js';

export interface IdGenerator {
  /** 22-char base64url from 16 random bytes. */
  newCertificateId(): CertificateId;
  /** 22-char base64url from 16 random bytes: id of organizations, events and other entities. */
  newEntityId(): string;
  /** Unguessable URL-safe token: 22-char base64url from 16 random bytes (e.g. PDF object names, unsubscribe links). */
  newToken(): string;
}
