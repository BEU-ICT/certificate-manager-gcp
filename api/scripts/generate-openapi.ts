// Writes api/openapi.json from the live route schemas (`npm run openapi:generate`).
// Needs no environment variables, network or credentials: it only builds the app and reads the spec.
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import prettier from 'prettier';
import { buildApp } from '../src/app.js';
import { openApiDocument } from '../src/http/openapi/plugin.js';

const target = fileURLToPath(new URL('../openapi.json', import.meta.url));

const app = buildApp();
await app.ready();
const document = openApiDocument(app);
await app.close();

// Keys are sorted by openApiDocument; prettier makes the file match the repo formatting.
const options = (await prettier.resolveConfig(target)) ?? {};
const text = await prettier.format(JSON.stringify(document), { ...options, filepath: target });
await writeFile(target, text);
process.stdout.write(`wrote ${target}\n`);
