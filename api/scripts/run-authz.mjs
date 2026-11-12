// `npm run test:authz [-- --base-url https://<domain>]`: runs the authorisation matrix. Without a
// base URL it uses in-memory fakes only; with one (or BASE_URL, kept for convenience) it runs the deployed-environment
// variant, which sends credential-free requests only. Never run against production data paths.
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
let baseUrl = process.env.BASE_URL;
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === '--base-url') baseUrl = args[i + 1];
  else if (arg.startsWith('--base-url=')) baseUrl = arg.slice('--base-url='.length);
}
if (baseUrl !== undefined && !/^https?:\/\/[^\s/]+/.test(baseUrl)) {
  console.error('test:authz: --base-url must be an http(s) URL');
  process.exit(2);
}
const files = baseUrl ? ['test/unit/authz-deployed.test.ts'] : ['test/unit/authz-matrix.test.ts'];
const env = { ...process.env };
delete env.AUTHZ_BASE_URL;
if (baseUrl) env.AUTHZ_BASE_URL = baseUrl;
const result = spawnSync('npx', ['vitest', 'run', ...files], {
  stdio: 'inherit',
  env,
});
process.exit(result.status ?? 1);
