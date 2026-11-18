import type { Pool } from 'pg';
import type { Certificate, CertificateEvent, Organization, Template } from '../../shared/domain.js';
import { certificateInsert } from './certificate-repository.js';

/**
 * Idempotent bulk writes keyed by id, for the NDJSON import (BEU-ICT/certificate-manager#439).
 * Each call is one statement per batch, so a batch is all-or-nothing; the caller retries a failed
 * batch record by record to isolate rejects.
 */
export async function upsertOrganizations(
  pool: Pool,
  items: readonly Organization[],
): Promise<void> {
  if (items.length === 0) return;
  await pool.query(
    `INSERT INTO organizations (id, slug, name, created_at, updated_at, schema_version)
     SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::timestamptz[], $5::timestamptz[], $6::int[])
     ON CONFLICT (id) DO UPDATE SET slug = EXCLUDED.slug, name = EXCLUDED.name,
       created_at = EXCLUDED.created_at, updated_at = EXCLUDED.updated_at,
       schema_version = EXCLUDED.schema_version`,
    [
      items.map((o) => o.id),
      items.map((o) => o.slug),
      items.map((o) => o.name),
      items.map((o) => o.createdAt),
      items.map((o) => o.updatedAt),
      items.map((o) => o.schemaVersion),
    ],
  );
}

export async function upsertEvents(pool: Pool, items: readonly CertificateEvent[]): Promise<void> {
  if (items.length === 0) return;
  await pool.query(
    `INSERT INTO events (id, organization_id, slug, name, email_language, created_at, updated_at, schema_version)
     SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[],
       $6::timestamptz[], $7::timestamptz[], $8::int[])
     ON CONFLICT (id) DO UPDATE SET organization_id = EXCLUDED.organization_id, slug = EXCLUDED.slug,
       name = EXCLUDED.name, email_language = EXCLUDED.email_language,
       created_at = EXCLUDED.created_at, updated_at = EXCLUDED.updated_at,
       schema_version = EXCLUDED.schema_version`,
    [
      items.map((e) => e.id),
      items.map((e) => e.organizationId),
      items.map((e) => e.slug),
      items.map((e) => e.name),
      items.map((e) => e.emailLanguage),
      items.map((e) => e.createdAt),
      items.map((e) => e.updatedAt),
      items.map((e) => e.schemaVersion),
    ],
  );
}

export async function upsertTemplates(pool: Pool, items: readonly Template[]): Promise<void> {
  if (items.length === 0) return;
  await pool.query(
    `INSERT INTO templates (reference, organization_id, event_id, organization_slug, event_slug,
       type, version, storage_path, config, created_at, created_by, schema_version)
     SELECT r, o, e, os, es, t, v, sp, c::jsonb, ca, cb, sv
     FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::int[],
       $8::text[], $9::text[], $10::timestamptz[], $11::text[], $12::int[])
       AS x(r, o, e, os, es, t, v, sp, c, ca, cb, sv)
     ON CONFLICT (reference) DO UPDATE SET organization_id = EXCLUDED.organization_id,
       event_id = EXCLUDED.event_id, organization_slug = EXCLUDED.organization_slug,
       event_slug = EXCLUDED.event_slug, type = EXCLUDED.type, version = EXCLUDED.version,
       storage_path = EXCLUDED.storage_path, config = EXCLUDED.config,
       created_at = EXCLUDED.created_at, created_by = EXCLUDED.created_by,
       schema_version = EXCLUDED.schema_version`,
    [
      items.map((t) => t.reference),
      items.map((t) => t.organizationId),
      items.map((t) => t.eventId),
      items.map((t) => t.organizationSlug),
      items.map((t) => t.eventSlug),
      items.map((t) => t.type),
      items.map((t) => t.version),
      items.map((t) => t.storagePath),
      items.map((t) => JSON.stringify(t.config)),
      items.map((t) => t.createdAt),
      items.map((t) => t.createdBy),
      items.map((t) => t.schemaVersion),
    ],
  );
}

/** At most 500 certificates per call (the same limit as `createMany`). */
export async function upsertCertificates(pool: Pool, items: readonly Certificate[]): Promise<void> {
  if (items.length === 0) return;
  const { sql, params } = certificateInsert(items, { upsert: true });
  await pool.query(sql, params);
}
