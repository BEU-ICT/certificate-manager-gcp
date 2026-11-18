/**
 * Initial schema (BEU-ICT/certificate-manager#429). IDs are plain `text`; relations are plain IDs
 * without foreign keys (the services veto deletes, as with Firestore). Every statement is
 * idempotent, so re-running the file against an existing schema changes nothing.
 * Timestamps are `timestamptz`; lists are ordered newest first with an `id` tie-break, which
 * the composite indexes below serve (keyset pagination, see `keyset.ts`).
 */
export const sql = `
CREATE TABLE IF NOT EXISTS organizations (
  id             text PRIMARY KEY,
  slug           text NOT NULL,
  name           text NOT NULL,
  created_at     timestamptz NOT NULL,
  updated_at     timestamptz NOT NULL,
  schema_version integer NOT NULL
);
-- Replaces the slug reservation document.
CREATE UNIQUE INDEX IF NOT EXISTS organizations_slug_key ON organizations (slug);
-- list(): name asc, id asc.
CREATE INDEX IF NOT EXISTS organizations_name_id_idx ON organizations (name, id);

CREATE TABLE IF NOT EXISTS events (
  id              text PRIMARY KEY,
  organization_id text NOT NULL,
  slug            text NOT NULL,
  name            text NOT NULL,
  email_language  text NOT NULL CHECK (email_language IN ('az', 'en')),
  created_at      timestamptz NOT NULL,
  updated_at      timestamptz NOT NULL,
  schema_version  integer NOT NULL
);
-- Replaces the (organization, slug) reservation document.
CREATE UNIQUE INDEX IF NOT EXISTS events_organization_slug_key ON events (organization_id, slug);
CREATE INDEX IF NOT EXISTS events_created_idx ON events (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS events_organization_created_idx
  ON events (organization_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS templates (
  reference         text PRIMARY KEY,
  organization_id   text NOT NULL,
  event_id          text NOT NULL,
  organization_slug text NOT NULL,
  event_slug        text NOT NULL,
  type              text NOT NULL,
  version           integer NOT NULL CHECK (version >= 0),
  storage_path      text NOT NULL,
  config            jsonb NOT NULL,
  created_at        timestamptz NOT NULL,
  created_by        text NOT NULL,
  schema_version    integer NOT NULL
);
-- getLatest / maxVersion: highest version of the (organization, event, type) triple.
CREATE UNIQUE INDEX IF NOT EXISTS templates_triple_version_key
  ON templates (organization_id, event_id, type, version DESC);
-- list(): created_at desc, reference desc, with the optional equality filters.
CREATE INDEX IF NOT EXISTS templates_created_idx ON templates (created_at DESC, reference DESC);
CREATE INDEX IF NOT EXISTS templates_organization_created_idx
  ON templates (organization_id, created_at DESC, reference DESC);
CREATE INDEX IF NOT EXISTS templates_event_created_idx
  ON templates (event_id, created_at DESC, reference DESC);
CREATE INDEX IF NOT EXISTS templates_type_created_idx
  ON templates (type, created_at DESC, reference DESC);

CREATE TABLE IF NOT EXISTS certificates (
  id                text PRIMARY KEY,
  organization_id   text NOT NULL,
  event_id          text NOT NULL,
  organization_name text NOT NULL,
  event_name        text NOT NULL,
  template_id       text NOT NULL,
  type              text NOT NULL,
  owner_name        text NOT NULL,
  email             text,
  subject           text NOT NULL,
  skills            text[] NOT NULL DEFAULT '{}',
  status            text NOT NULL CHECK (status IN ('active', 'revoked')),
  issued_at         timestamptz NOT NULL,
  revoked_at        timestamptz,
  revoke_reason     text,
  email_status      text NOT NULL CHECK (email_status IN ('pending', 'sent', 'failed', 'skipped')),
  email_attempts    integer NOT NULL DEFAULT 0,
  email_sent_at     timestamptz,
  email_last_error  text,
  pdf_path          text,
  pdf_generated_at  timestamptz,
  legacy            jsonb,
  created_by        text NOT NULL,
  created_at        timestamptz NOT NULL,
  updated_at        timestamptz NOT NULL,
  schema_version    integer NOT NULL
);
-- list(): issued_at desc, id desc under any combination of the five equality filters and the
-- issued_at range. One index per filter column (planner picks the most selective and filters the
-- rest while reading in order), plus the (organization, event) pair that Firestore also indexes.
CREATE INDEX IF NOT EXISTS certificates_issued_idx ON certificates (issued_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS certificates_organization_issued_idx
  ON certificates (organization_id, issued_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS certificates_event_issued_idx
  ON certificates (event_id, issued_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS certificates_organization_event_issued_idx
  ON certificates (organization_id, event_id, issued_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS certificates_type_issued_idx
  ON certificates (type, issued_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS certificates_status_issued_idx
  ON certificates (status, issued_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS certificates_email_status_issued_idx
  ON certificates (email_status, issued_at DESC, id DESC);
-- countByTemplate.
CREATE INDEX IF NOT EXISTS certificates_template_idx ON certificates (template_id);

-- Generic reservations (keys that are not covered by a natural unique constraint).
CREATE TABLE IF NOT EXISTS uniques (
  key        text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS idempotency (
  id              text PRIMARY KEY,
  request_hash    text NOT NULL,
  attempt_id      text NOT NULL,
  state           text NOT NULL CHECK (state IN ('in_progress', 'completed')),
  response_status integer,
  response_body   jsonb,
  created_at      timestamptz NOT NULL,
  expires_at      timestamptz NOT NULL,
  schema_version  integer NOT NULL
);
CREATE INDEX IF NOT EXISTS idempotency_expires_idx ON idempotency (expires_at);

CREATE TABLE IF NOT EXISTS email_counters (
  id             text PRIMARY KEY,
  used           integer NOT NULL DEFAULT 0 CHECK (used >= 0),
  expires_at     timestamptz NOT NULL,
  schema_version integer NOT NULL
);
CREATE INDEX IF NOT EXISTS email_counters_expires_idx ON email_counters (expires_at);
`;
