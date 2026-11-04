// Verifies from dist/.vite/manifest.json that the Firebase SDK is reachable only from the admin
// routes: the entry chunk and every non-admin lazy route must not statically import it.
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync(new URL('../dist/.vite/manifest.json', import.meta.url)));
const isFirebase = (key) => /(^|\/)firebase[-.]/.test(manifest[key]?.file ?? '');
const firebaseKeys = Object.keys(manifest).filter(isFirebase);
if (firebaseKeys.length === 0) {
  console.error('check:bundle: no firebase chunk found, the admin bundle should contain it');
  process.exit(1);
}

function staticClosure(start) {
  const seen = new Set();
  const stack = [start];
  while (stack.length > 0) {
    const key = stack.pop();
    if (seen.has(key)) continue;
    seen.add(key);
    stack.push(...(manifest[key]?.imports ?? []));
  }
  return seen;
}

const adminSources = /^src\/(admin|auth)\//;
let failed = false;
for (const [key, chunk] of Object.entries(manifest)) {
  if (!chunk.isEntry && !chunk.isDynamicEntry) continue;
  if (adminSources.test(chunk.src ?? key)) continue;
  const leaked = [...staticClosure(key)].filter(isFirebase);
  if (leaked.length > 0) {
    failed = true;
    console.error(`check:bundle: ${chunk.src ?? key} statically imports the Firebase SDK`);
  }
}
if (failed) process.exit(1);
console.log('check:bundle: Firebase SDK is only in the admin bundle');
