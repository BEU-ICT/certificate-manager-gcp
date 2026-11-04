/**
 * Version of the stored document shape. Repositories write `schemaVersion: SCHEMA_VERSION` on
 * every document they create. Readers ignore fields they do not know (parse with zod's default
 * object schema or `.passthrough()` at the adapter boundary; DTOs strip them), so a newer
 * revision can add fields while an older one still serves traffic. Raise the number only for a
 * change that readers of the old shape cannot tolerate, and ship a migration with it.
 */
export const SCHEMA_VERSION = 1;
