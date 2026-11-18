import { cpSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import jsQR from 'jsqr';

// Full operator flow against the local stack: Auth + Firestore emulators, fs storage, the file e-mail
// sink and the in-process queue (`npm run test:e2e:auth`, see playwright.config.ts). Data lives in a
// throw-away directory (E2E_DATA_DIR); the only account is the locally seeded administrator.
// The locale is az-AZ, so selectors use the Azerbaijani UI strings.
const emulator = process.env['E2E_AUTH_EMULATOR'] === 'true';
const adminEmail = process.env['E2E_ADMIN_EMAIL'] ?? '';
const adminPassword = process.env['E2E_ADMIN_PASSWORD'] ?? '';
const dataDir = process.env['E2E_DATA_DIR'] ?? '';
const mailDir = join(dataDir, 'mail');
const referencePackage = fileURLToPath(new URL('../../docs/templates/reference', import.meta.url));

const suffix = Date.now().toString(36);
const orgName = `Flow Org ${suffix}`;
const eventName = `Flow Event ${suffix}`;
const ownerName = `Aysel Məmmədova ${suffix}`;
const recipient = `aysel-${suffix}@example.test`;
const subject = 'Veb inkişaf';

let certificateId = '';

const emlFiles = (): string[] => {
  try {
    return readdirSync(mailDir).filter((f) => f.endsWith('.eml'));
  } catch {
    return [];
  }
};
/** Text of the base64 parts of an .eml file (the sink encodes text and HTML as base64). */
const decodedBodies = (eml: string): string =>
  (eml.match(/(?:^[A-Za-z0-9+/=]{16,}\r?\n?)+/gm) ?? [])
    .map((block) => Buffer.from(block.replace(/\s+/g, ''), 'base64').toString('utf8'))
    .join('\n');
const emlFor = (id: string): string[] => emlFiles().filter((f) => f.includes(id));

async function selectTarget(page: Page): Promise<void> {
  await page.getByLabel(/^Təşkilat/).selectOption({ label: orgName });
  await page.getByLabel(/^Tədbir/).selectOption({ label: eventName });
  await page.getByLabel(/^Növ/).selectOption('attendance');
}

async function dashboardCounts(
  page: Page,
  refresh = false,
): Promise<{ total: number; active: number; revoked: number }> {
  await page.goto('/admin');
  if (refresh) {
    // The API caches the counts; a refresh is allowed once per 10 s per administrator.
    const refreshed = page.waitForResponse(
      (r) => r.url().includes('/api/v1/admin/stats') && r.url().includes('refresh=true'),
    );
    await page.getByRole('button', { name: 'Yenilə' }).click();
    expect((await refreshed).status()).toBe(200);
  }
  const read = async (label: string): Promise<number> => {
    const tile = page.getByRole('link', { name: new RegExp(label) });
    await expect(tile).toBeVisible();
    const text = (await tile.innerText()).replace(/\s+/g, ' ');
    const match = /(\d[\d.,]*)/.exec(text.replace(label, ''));
    expect(match, `no number in tile "${label}"`).not.toBeNull();
    return Number((match?.[1] ?? '').replace(/\D/g, ''));
  };
  return {
    total: await read('Ümumi sertifikatlar'),
    active: await read('Aktiv sertifikatlar'),
    revoked: await read('Ləğv edilmiş sertifikatlar'),
  };
}

test.describe.configure({ mode: 'serial' });

test.describe('full flow: sign in to revoke', () => {
  test.skip(
    !emulator || !adminEmail || !adminPassword || !dataDir,
    'needs the dev stack (npm run test:e2e:auth); see web/README.md (Testing)',
  );
  test.setTimeout(120_000);

  let before = { total: 0, active: 0, revoked: 0 };

  let page: Page;
  test.beforeAll(async ({ browser }) => {
    // One signed-in browser context for the whole serial flow (Firebase keeps the session in IndexedDB).
    page = await (await browser.newContext()).newPage();
    await page.goto('/admin');
    await page.getByLabel(/^E-poçt/).fill(adminEmail);
    await page.locator('input[autocomplete="current-password"]').fill(adminPassword);
    await page.getByRole('button', { name: 'Daxil ol' }).click();
    await expect(page).toHaveURL(/\/admin\/?$/);
    before = await dashboardCounts(page);
  });
  test.afterAll(async () => {
    await page.context().close();
  });

  test('creates an organization and an event, uploads the reference template, previews it', async () => {
    await page.goto('/admin/organizations');
    await page.getByRole('button', { name: 'Yeni təşkilat' }).first().click();
    let dialog = page.getByRole('dialog');
    await dialog.getByLabel(/^Ad/).fill(orgName);
    await dialog.getByRole('button', { name: 'Yarat' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('cell', { name: orgName, exact: true })).toBeVisible();

    await page.goto('/admin/events');
    await page.getByRole('button', { name: 'Yeni tədbir' }).first().click();
    dialog = page.getByRole('dialog');
    await dialog.getByLabel(/^Təşkilat/).selectOption({ label: orgName });
    await dialog.getByLabel(/^Ad/).fill(eventName);
    await dialog.getByRole('button', { name: 'Yarat' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('cell', { name: eventName, exact: true })).toBeVisible();

    // golden.png is a test artefact and fonts/LICENSE.txt is refused by the upload (layout allows only
    // background.svg, fonts/*.ttf, assets/*.png|jpg), so neither is uploaded (see PR description).
    const upload = join(tmpdir(), `cm-e2e-template-${suffix}`, 'reference');
    mkdirSync(upload, { recursive: true });
    cpSync(referencePackage, upload, {
      recursive: true,
      filter: (src) => !/(golden\.png|LICENSE\.txt)$/.test(src),
    });
    await page.goto('/admin/templates/new');
    await selectTarget(page);
    await page.getByLabel('Qovluq seç').setInputFiles(upload);
    await page.getByRole('button', { name: 'Yüklə', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Şablon yükləndi' })).toBeVisible();
    await page.getByRole('button', { name: 'Şablonu aç' }).click();
    await expect(page).toHaveURL(/\/admin\/templates\/.+-v0$/);

    dialog = page.getByRole('dialog');
    // The page re-renders while the template loads; click again if the first click was lost.
    await expect(async () => {
      await page.getByRole('button', { name: 'Önbaxış' }).click();
      await expect(dialog).toBeVisible({ timeout: 3_000 });
    }).toPass({ timeout: 30_000 });
    await dialog.getByRole('button', { name: 'Hazırla' }).click();
    await expect(dialog.getByText('Önbaxış hazırdır.')).toBeVisible({ timeout: 60_000 });
    await dialog.getByRole('button', { name: 'Bağla' }).first().click();
  });

  test('issues a single certificate and writes the e-mail to the sink', async () => {
    await page.goto('/admin/certificates/new');
    await selectTarget(page);
    await page.getByLabel(/^Sahibinin adı/).fill(ownerName);
    await page.getByLabel(/^E-poçt ünvanı/).fill(recipient);
    await page.getByLabel(/^Mövzu/).fill(subject);
    await page.getByRole('button', { name: 'Sertifikat ver', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Sertifikat verildi' })).toBeVisible({
      timeout: 60_000,
    });
    await page.getByRole('link', { name: 'Sertifikata bax' }).click();
    await expect(page).toHaveURL(/\/admin\/certificates\/[^/]+$/);
    certificateId = new URL(page.url()).pathname.split('/').pop() ?? '';
    expect(certificateId).not.toBe('');

    await expect.poll(() => emlFor(certificateId).length, { timeout: 30_000 }).toBe(1);
    const eml = readFileSync(join(mailDir, emlFor(certificateId)[0] ?? ''), 'utf8');
    expect(eml).toContain(`<${recipient}>`);
    expect(decodedBodies(eml)).toContain(`/c/${certificateId}`);
  });

  test('imports a small CSV through the wizard', async () => {
    const csv = join(tmpdir(), `cm-e2e-import-${suffix}.csv`);
    writeFileSync(
      csv,
      [
        'ownerName,email,subject',
        `Orxan Əliyev ${suffix},orxan-${suffix}@example.test,Python`,
        `Leyla Həsənova ${suffix},,Dizayn`,
        '',
      ].join('\n'),
    );
    await page.goto('/admin/certificates/import');
    await selectTarget(page);
    await page.getByLabel(/^Cədvəl faylı/).setInputFiles(csv);
    await page.getByRole('button', { name: 'Önbaxışa keç' }).click();
    await page.getByRole('button', { name: '2 sertifikatı idxal et' }).click();
    await expect(page.getByText('Yaradılan sertifikatlar: 2')).toBeVisible({ timeout: 90_000 });
    await expect(page.getByText('Növbəyə qoyulan e-poçtlar: 1')).toBeVisible();
    await expect.poll(() => emlFiles().length, { timeout: 30_000 }).toBeGreaterThanOrEqual(2);
  });

  test('lists the certificates and opens the detail page', async () => {
    await page.goto('/admin/certificates');
    await expect(page.getByText(`Orxan Əliyev ${suffix}`)).toBeVisible();
    await expect(page.getByText(`Leyla Həsənova ${suffix}`)).toBeVisible();
    await page.getByText(ownerName).first().click();
    await expect(page).toHaveURL(new RegExp(`/admin/certificates/${certificateId}$`));
    await expect(page.getByText(certificateId).first()).toBeVisible();
    await expect(page.getByText(subject).first()).toBeVisible();
    await expect(page.getByText('Aktiv').first()).toBeVisible();
  });

  test('serves the public page and a valid PDF', async ({ request }) => {
    await page.goto(`/c/${certificateId}`);
    await expect(page.getByText('Sertifikat etibarlıdır')).toBeVisible();
    await expect(page.getByText(ownerName).first()).toBeVisible();
    await expect(page.getByText(eventName).first()).toBeVisible();
    await expect(page.getByRole('link', { name: /PDF yüklə/ })).toBeVisible();
    // The public page must not leak the e-mail address.
    await expect(page.locator('body')).not.toContainText(recipient);

    const pdf = await request.get(`/api/v1/public/certificates/${certificateId}/pdf`);
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()['content-type']).toContain('application/pdf');
    const body = await pdf.body();
    expect(body.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(body.length).toBeGreaterThan(5_000);
    expect(body.subarray(-1024).toString('latin1')).toContain('%%EOF');
  });

  test('shows the QR code of the public link on the detail page', async () => {
    await page.goto(`/admin/certificates/${certificateId}`);
    const qr = page.getByRole('img', { name: /QR/ });
    await expect(qr).toBeVisible();
    await expect(qr).toHaveAttribute('alt', new RegExp(`/c/${certificateId}`));
    // Decode the rendered QR image: it must point at the public page of this certificate.
    const pixels = await qr.evaluate(async (img: HTMLImageElement) => {
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx?.drawImage(img, 0, 0);
      const data = ctx?.getImageData(0, 0, canvas.width, canvas.height);
      return { width: canvas.width, height: canvas.height, data: Array.from(data?.data ?? []) };
    });
    const decoded = jsQR(Uint8ClampedArray.from(pixels.data), pixels.width, pixels.height);
    expect(decoded?.data).toBe(`${new URL(page.url()).origin}/c/${certificateId}`);
  });

  test('revokes the certificate: public page shows it, the PDF is gone', async ({ request }) => {
    await page.goto(`/admin/certificates/${certificateId}`);
    await page.getByRole('button', { name: 'Ləğv et', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(/^Ləğv səbəbi/).fill('E2E test');
    await dialog.getByLabel('Başa düşürəm').check();
    await dialog.getByRole('button', { name: 'Sertifikatı ləğv et' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText('Ləğv edilib').first()).toBeVisible();

    await page.goto(`/c/${certificateId}`);
    await expect(page.getByText('Bu sertifikat ləğv edilib')).toBeVisible();
    await expect(page.getByRole('link', { name: /PDF yüklə/ })).toHaveCount(0);
    const pdf = await request.get(`/api/v1/public/certificates/${certificateId}/pdf`, {
      maxRedirects: 0,
    });
    expect(pdf.status()).toBe(410);
  });

  test('resends the e-mail of an active certificate', async () => {
    await page.goto('/admin/certificates');
    await page.getByText(`Orxan Əliyev ${suffix}`).click();
    await expect(page).toHaveURL(/\/admin\/certificates\/[^/]+$/);
    const otherId = new URL(page.url()).pathname.split('/').pop() ?? '';
    const sent = emlFor(otherId).length;
    await page.getByRole('button', { name: 'E-poçtu yenidən göndər' }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'E-poçtu yenidən göndər' }).click();
    await expect.poll(() => emlFor(otherId).length, { timeout: 30_000 }).toBe(sent + 1);
  });

  test('dashboard counts reflect the new and revoked certificates', async () => {
    const after = await dashboardCounts(page, true);
    expect(after.total - before.total).toBe(3);
    expect(after.active - before.active).toBe(2);
    expect(after.revoked - before.revoked).toBe(1);
  });

  test('public certificate page works on a phone viewport', async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 375, height: 812 },
      isMobile: true,
      hasTouch: true,
      locale: 'az-AZ',
    });
    const page = await context.newPage();
    await page.goto('/c/' + certificateId);
    await expect(page.getByText('Bu sertifikat ləğv edilib')).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await context.close();
  });
});
