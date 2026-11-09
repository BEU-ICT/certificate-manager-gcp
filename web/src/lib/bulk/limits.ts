/** Import limits, enforced before parsing where possible (issue #124). */
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_DATA_ROWS = 5_000;
export const MAX_COLUMNS = 20;
/** Files above this size are parsed in a Web Worker to keep the UI responsive. */
export const WORKER_THRESHOLD_BYTES = 1024 * 1024;
/** Cap on the total uncompressed size of an .xlsx archive (zip-bomb guard, checked before reading). */
export const MAX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;
