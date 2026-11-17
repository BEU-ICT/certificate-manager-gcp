import { resolve } from 'node:path';
import type { StorageGateway } from '../../ports/index.js';
import type { AdapterContext } from '../registry.js';
import { DEFAULT_FS_ROOT, FsStorageGateway } from './storage-gateway.js';

export { FsStorageGateway, isSafeKey, DEFAULT_FS_ROOT } from './storage-gateway.js';
export { registerFsPublicPdfRoutes } from './public-pdf-routes.js';

/** Root directory: `STORAGE_FS_ROOT` (relative to the working directory) or `.local-data/storage`. */
export function fsStorageRoot(env: Readonly<Record<string, string | undefined>>): string {
  return resolve(env['STORAGE_FS_ROOT'] || DEFAULT_FS_ROOT);
}

export function createStorageGateway(ctx: AdapterContext): StorageGateway {
  return new FsStorageGateway(fsStorageRoot(process.env), ctx.config.pdfPublicBaseUrl);
}
