/**
 * Byte-order sorting (BEU-ICT/certificate-manager#430). Firestore orders strings by UTF-8 bytes;
 * the repositories' keyset order must not depend on the server's locale, so the sort-key columns
 * use the `C` collation (the dependent indexes are rebuilt by Postgres).
 */
export const sql = `
ALTER TABLE organizations ALTER COLUMN name TYPE text COLLATE "C";
ALTER TABLE organizations ALTER COLUMN id TYPE text COLLATE "C";
ALTER TABLE events ALTER COLUMN id TYPE text COLLATE "C";
ALTER TABLE templates ALTER COLUMN reference TYPE text COLLATE "C";
ALTER TABLE certificates ALTER COLUMN id TYPE text COLLATE "C";
`;
