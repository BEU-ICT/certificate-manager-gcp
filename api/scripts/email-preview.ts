// Writes sample certificate e-mails for review: `npm run email:preview -- <az|en> [outDir]`.
// Default output: <os tmpdir>/cm-email-preview (outside the repository). Sample data only.
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { renderCertificateEmail } from '../src/modules/notifications/index.js';
import { EMAIL_LANGUAGES, type EmailLanguage } from '../src/shared/domain.js';

const [lang, outArg] = process.argv.slice(2);
if (!EMAIL_LANGUAGES.includes(lang as EmailLanguage)) {
  process.stderr.write('Usage: email-preview.ts <az|en> [outDir]\n');
  process.exit(2);
}
const language = lang as EmailLanguage;
const outDir = outArg ?? path.join(os.tmpdir(), 'cm-email-preview');
const content = renderCertificateEmail({
  language,
  ownerName: 'Aygün Məmmədova',
  organizationName: 'Example Organization',
  eventName: 'Workshop: Şəbəkə təhlükəsizliyi',
  verifyUrl: 'https://certificates.example.org/c/ABCDEFGH',
  contactEmail: 'support@example.org',
});
await mkdir(outDir, { recursive: true });
await writeFile(path.join(outDir, `certificate-${language}.html`), content.html, 'utf8');
await writeFile(path.join(outDir, `certificate-${language}.txt`), content.text, 'utf8');
process.stdout.write(`Subject: ${content.subject}\nWritten to ${outDir}\n`);
