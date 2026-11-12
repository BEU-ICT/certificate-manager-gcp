// Verifies from dist/.vite/manifest.json that the Firebase SDK is reachable only from the admin
// routes: the entry chunk and every non-admin lazy route (public pages, 404, i18n files) must
// neither import the SDK chunk nor any chunk that loads it, statically. The SDK is only ever
// loaded through a dynamic import inside `src/auth`, and its gzipped size stays within budget.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

/** Gzipped budget for the Firebase chunk(s): Auth only, no Analytics/Firestore (BEU-ICT/certificate-manager#290). */
export const MAX_FIREBASE_GZIP_BYTES = 80 * 1024;

// `src/lib/bulk` (spreadsheet import) is reachable only from the admin import wizard.
const ADMIN_SOURCES = /^src\/(admin|auth|lib\/bulk)\//;

/**
 * @param {Record<string, any>} manifest Vite manifest
 * @param {(file: string) => number} gzipSize gzipped byte size of a built file
 * @returns {string[]} problems, empty when the bundle is fine
 */
export function checkBundle(manifest, gzipSize = () => 0) {
  const problems = [];
  const isFirebase = (key) => /(^|\/)firebase[-.]/.test(manifest[key]?.file ?? '');
  const firebaseKeys = Object.keys(manifest).filter(isFirebase);
  if (firebaseKeys.length === 0) {
    return ['no firebase chunk found, the admin bundle should contain it'];
  }

  // Chunks that load the SDK (statically or dynamically): the SDK itself plus its callers.
  const loaders = new Set(firebaseKeys);
  for (const [key, chunk] of Object.entries(manifest)) {
    const refs = [...(chunk.imports ?? []), ...(chunk.dynamicImports ?? [])];
    if (refs.some((ref) => firebaseKeys.includes(ref))) loaders.add(key);
  }

  const staticClosure = (start) => {
    const seen = new Set();
    const stack = [start];
    while (stack.length > 0) {
      const key = stack.pop();
      if (seen.has(key)) continue;
      seen.add(key);
      stack.push(...(manifest[key]?.imports ?? []));
    }
    return seen;
  };

  for (const [key, chunk] of Object.entries(manifest)) {
    if (!chunk.isEntry && !chunk.isDynamicEntry) continue;
    if (ADMIN_SOURCES.test(chunk.src ?? key)) continue;
    const leaked = [...staticClosure(key)].filter((k) => loaders.has(k));
    if (leaked.length > 0) {
      problems.push(
        `${chunk.src ?? key} statically imports the Firebase SDK (via ${leaked.join(', ')})`,
      );
    }
  }

  const bytes = firebaseKeys.reduce((sum, key) => sum + gzipSize(manifest[key].file), 0);
  if (bytes > MAX_FIREBASE_GZIP_BYTES) {
    problems.push(
      `the Firebase chunk is ${(bytes / 1024).toFixed(1)} KB gzipped, over the ` +
        `${MAX_FIREBASE_GZIP_BYTES / 1024} KB budget`,
    );
  }
  return problems;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const dist = new URL('../dist/', import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL('.vite/manifest.json', dist)));
  const problems = checkBundle(
    manifest,
    (file) => gzipSync(readFileSync(new URL(file, dist))).length,
  );
  if (problems.length > 0) {
    for (const problem of problems) console.error(`check:bundle: ${problem}`);
    process.exit(1);
  }
  console.log('check:bundle: Firebase SDK is only in the admin bundle');
}
