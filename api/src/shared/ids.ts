import { NotFoundError } from './errors.js';

/** Branded string IDs. Relations between entities are always plain string IDs. */
declare const brand: unique symbol;
type Brand<T extends string> = string & { readonly [brand]: T };

export type CertificateId = Brand<'CertificateId'>;
export type OrganizationId = Brand<'OrganizationId'>;
export type EventId = Brand<'EventId'>;
export type TemplateRef = Brand<'TemplateRef'>;

/** 22-char base64url (new IDs) or 32 lowercase hex (legacy MD5 hashes). */
export const CERTIFICATE_ID_PATTERN = /^(?:[A-Za-z0-9_-]{22}|[0-9a-f]{32})$/;
/** `<name>-v<version>`; the reference is never parsed (see BEU-ICT/certificate-manager#236). */
export const TEMPLATE_REF_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*-v(0|[1-9][0-9]*)$/;
/** Firestore-style auto IDs and slugs-based IDs are opaque; only shape and length are checked. */
export const ENTITY_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function isCertificateId(value: unknown): value is CertificateId {
  return typeof value === 'string' && CERTIFICATE_ID_PATTERN.test(value);
}

export function isTemplateRef(value: unknown): value is TemplateRef {
  return typeof value === 'string' && value.length <= 128 && TEMPLATE_REF_PATTERN.test(value);
}

export function isOrganizationId(value: unknown): value is OrganizationId {
  return typeof value === 'string' && ENTITY_ID_PATTERN.test(value);
}

export function isEventId(value: unknown): value is EventId {
  return typeof value === 'string' && ENTITY_ID_PATTERN.test(value);
}

function assertValid<T>(value: unknown, guard: (v: unknown) => v is T, what: string): T {
  if (!guard(value)) throw new TypeError(`Invalid ${what}`);
  return value;
}

export const asCertificateId = (v: unknown): CertificateId =>
  assertValid(v, isCertificateId, 'CertificateId');
export const asTemplateRef = (v: unknown): TemplateRef =>
  assertValid(v, isTemplateRef, 'TemplateRef');
export const asOrganizationId = (v: unknown): OrganizationId =>
  assertValid(v, isOrganizationId, 'OrganizationId');
export const asEventId = (v: unknown): EventId => assertValid(v, isEventId, 'EventId');

/**
 * Parses a public certificate ID from untrusted input. A malformed value throws the same
 * `NotFoundError` as an unknown ID, so the response is not an oracle for the ID format.
 */
export function parseCertificateId(value: unknown): CertificateId {
  if (!isCertificateId(value)) throw new NotFoundError('Certificate not found');
  return value;
}
