import { bootstrapAdmin } from './001-bootstrap-admin.js';
import type { Migration } from './types.js';

/**
 * Every migration, in the order it runs. Append new migrations at the end; never reorder,
 * rename or remove one that has been deployed (its marker is keyed by id).
 */
export const migrations: readonly Migration[] = [bootstrapAdmin];
