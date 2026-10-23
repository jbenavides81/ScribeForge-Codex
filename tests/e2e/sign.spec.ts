// Stop 2e: signing and checking signatures, driven through the real app (docs/Plan_Sign.md,
// section 9): signing with a certificate file, an existing signature box, trusting a
// certificate, a file changed after signing, the warning when saving a signed file, making a
// certificate, and that no password is ever written anywhere.
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { expect, test, type Page } from '@playwright/test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { certificateDer, toBase64 } from '../../src/engine/sign/certificate';
import { checkSignatures } from '../../src/engine/sign/check';
import { readPfx } from '../../src/main/sign/pfx';
import { inspectPdf } from '../../src/engine/inspect';
import { THEME_CHOICES } from '../../src/shared/themes';
import { TEST_PFX_PASSWORD } from '../fixtures/signing';
import { answerDialogs, blockedRequests, closeApp, FIXTURES, fixtureHashes, goTo, launch, openFixture, passReview, SCREENS, setTheme, waitForFirstPage, type Running } from './helpers';

let current: Running | null = null;
test.afterEach(async () => {
  if (current) await closeApp(current.app).catch(() => {});
  current = null;
});
let hashesBefore: Record<string, string>;
test.beforeAll(() => {
  hashesBefore = fixtureHashes();
});
test.afterAll(() => {
  expect(fixtureHashes()).toEqual(hashesBefore);
});

const outDir = () => mkdtempSync(path.join(tmpdir(), 'scribeforge-e2e-out-'));
const read = (p: string) => new Uint8Array(readFileSync(p));
const screen = (win: Page) => win.getByTestId('sign-screen');
const dialog = (win: Page) => win.getByTestId('sign-dialog');
const page1 = (win: Page) => win.locator('.page[data-page-number="1"]');
const root = () => ({ der: toBase64(read(path.join(FIXTURES, 'test-root.cer'))), source: 'mine' as const });

/** Every file in a folder and the folders inside it. */
const filesIn = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => (statSync(path.join(dir, f)).isDirectory() ? filesIn(path.join(dir, f)) : [path.join(dir, f)]));

/** Opens the signing window and unlocks the test certificate file. */
async function unlockTestCertificate(run: Running, saveAs: string): Promise<void> {
  const { app, win } = run;
  await answerDialogs(app, { open: [path.join(FIXTURES, 'test-signer.pfx')], saveAs });
  await goTo(win, 'Sign');
  await screen(win).getByRole('button', { name: 'Sign this file…' }).click();
  await dialog(win).getByRole('button', { name: 'Choose a certificate file…' }).click();
  await expect(dialog(win).getByTestId('certificate-file')).toHaveText('test-signer.pfx');
  // A wrong password first: a plain message, and nothing opens.
  await dialog(win).getByLabel('Password for the certificate file').fill('not-the-password');
  await dialog(win).getByRole('button', { name: 'Next' }).click();
  await expect(dialog(win).getByRole('alert')).toHaveText("That password didn't work. Try again.");
  await dialog(win).getByLabel('Password for the certificate file').fill(TEST_PFX_PASSWORD);
  await dialog(win).getByRole('button', { name: 'Next' }).click();
  await expect(dialog(win).getByTestId('certificate-summary')).toContainText('Alex Example');
  await expect(dialog(win).getByTestId('certificate-summary')).toContainText('ScribeForge Test Root');
}

test('sign with a certificate file and a box drawn on the page: the signed file is valid, and the original unchanged', async ({}, info) => {
  const run = (current = await launch(info.project.name));
  const { app, win, userData } = run;
  await openFixture(run, 'normal.pdf');
  await waitForFirstPage(win);
  const target = path.join(outDir(), 'signed by test.pdf');
  await unlockTestCertificate(run, target);
  await dialog(win).getByLabel('Reason (optional)').fill('Approved in a test');
  await dialog(win).getByRole('button', { name: 'Draw the box…' }).click();
  await expect(win.getByTestId('placing-banner')).toBeVisible();
  const box = (await page1(win).boundingBox())!;
  await win.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.28);
  await win.mouse.down();
  await win.mouse.move(box.x + box.width * 0.9, box.y + box.height * 0.36, { steps: 6 });
  await win.mouse.up();
  await expect(win.getByTestId('message')).toContainText('Signed and saved signed by test.pdf', { timeout: 30_000 });

  // The signed file opens and says so; the Sign screen agrees.
  await expect(win.locator('.sf-doc-name')).toHaveText('signed by test.pdf');
  await expect(win.getByTestId('signatures-banner')).toContainText('This file has 1 signature: valid, identity not confirmed.');
  await goTo(win, 'Sign');
  await expect(screen(win).getByTestId('signature')).toHaveAttribute('data-status', 'valid');
  await expect(screen(win).getByTestId('signature')).toContainText('Signed by Alex Example');
  await expect(screen(win).getByTestId('signature')).toContainText('Reason: Approved in a test');
  await expect(screen(win).getByTestId('signature')).toContainText('Its box is on page 1.');

  // Checked separately: it starts with the original's exact bytes, and is valid and trusted through the test root.
  const signed = read(target);
  const original = read(path.join(FIXTURES, 'normal.pdf'));
  expect(Buffer.from(signed.subarray(0, original.length)).equals(Buffer.from(original))).toBe(true);
  const [check] = await checkSignatures(signed, [root()]);
  expect(check).toMatchObject({ status: 'valid', identity: 'mine', name: 'Alex Example', reason: 'Approved in a test', visible: true, page: 1 });

  expect(await blockedRequests(app)).toEqual([]);

  // The certificate's password is never written anywhere (checked once the app has closed its files); its location is remembered.
  await closeApp(app);
  current = null;
  for (const file of filesIn(userData)) expect(readFileSync(file).includes(Buffer.from(TEST_PFX_PASSWORD)), file).toBe(false);
  expect(JSON.parse(readFileSync(path.join(userData, 'settings.json'), 'utf8')).certificateFile).toBe(path.join(FIXTURES, 'test-signer.pfx'));
});

test('sign in an empty signature box the file already has', async ({}, info) => {
  const run = (current = await launch(info.project.name));
  const { win } = run;
  await openFixture(run, 'sign-here.pdf');
  await waitForFirstPage(win);
  const target = path.join(outDir(), 'form signed.pdf');
  await unlockTestCertificate(run, target);
  await dialog(win).getByLabel('In an empty signature box this file has').check();
  await expect(dialog(win).getByRole('combobox', { name: /^Signature box/ })).toHaveValue('Approver');
  await dialog(win).getByRole('button', { name: 'Sign and save…' }).click();
  await expect(win.getByTestId('message')).toContainText('Signed and saved form signed.pdf', { timeout: 30_000 });
  const [check] = await checkSignatures(read(target), [root()]);
  expect(check).toMatchObject({ field: 'Approver', status: 'valid', identity: 'mine', visible: true });
});

test('trust a certificate: the signature then says whose it is, until it is removed from the list', async ({}, info) => {
  const run = (current = await launch(info.project.name));
  const { win, userData } = run;
  await openFixture(run, 'signed-twice.pdf');
  await waitForFirstPage(win);
  await expect(win.getByTestId('signatures-banner')).toContainText('This file has 2 signatures: 2 valid, identity not confirmed.');
  await goTo(win, 'Sign');
  const [first, second] = [screen(win).getByTestId('signature').nth(0), screen(win).getByTestId('signature').nth(1)];
  await expect(first).toHaveAttribute('data-status', 'signed-after');
  await expect(first).toContainText('Only other signatures were added after it.');
  await expect(second).toContainText('Signed by Sam Example');
  await expect(second).toContainText('Certificate: Sam Example, which issued itself.');
  await expect(screen(win).getByTestId('trusted-none')).toBeVisible();

  await second.getByRole('button', { name: 'Trust this certificate…' }).click();
  const confirm = win.getByTestId('confirm-dialog');
  await expect(confirm).toContainText('Fingerprint:');
  await confirm.getByRole('button', { name: 'Trust it' }).click();
  await expect(second).toHaveAttribute('data-identity', 'mine');
  await expect(second).toContainText('You chose to trust this certificate.');
  await expect(screen(win).getByTestId('trusted-list')).toContainText('Sam Example');
  expect(JSON.parse(readFileSync(path.join(userData, 'settings.json'), 'utf8')).trustedCertificates).toHaveLength(1);

  await screen(win).getByRole('button', { name: 'Stop trusting Sam Example' }).click();
  await expect(second).toHaveAttribute('data-identity', 'unknown');
  await expect(screen(win).getByTestId('trusted-none')).toBeVisible();
});

test('a file changed after signing says so, and Open the signed version shows what was signed', async ({}, info) => {
  const run = (current = await launch(info.project.name));
  const { win } = run;
  await openFixture(run, 'signed-changed.pdf');
  await waitForFirstPage(win);
  await expect(win.getByTestId('signatures-banner')).toContainText('This file has 1 signature: changed after signing.');
  await goTo(win, 'Sign');
  const item = screen(win).getByTestId('signature');
  await expect(item).toHaveAttribute('data-status', 'changed');
  await expect(item).toContainText('Alex Example signed an earlier version. Open the signed version to see what they signed.');
  await item.getByRole('button', { name: 'Open the signed version' }).click();
  await expect(win.locator('.sf-doc-name')).toHaveText('signed-changed (as signed by Alex Example).pdf');
  await expect(win.getByTestId('signatures-banner')).toContainText('This file has 1 signature: valid, identity not confirmed.');
  // The changed line isn't in the signed version.
  await win.getByLabel('Find in document').fill('MALLORY');
  await win.getByLabel('Find in document').press('Enter');
  await expect(win.getByTestId('find-count')).toHaveText('Not found');
});

test('saving a signed file asks first, and the new file has no signature and no signature box', async ({}, info) => {
  const run = (current = await launch(info.project.name));
  const { app, win } = run;
  await openFixture(run, 'signed.pdf');
  await waitForFirstPage(win);
  const target = path.join(outDir(), 'unsigned copy.pdf');
  await answerDialogs(app, { saveAs: target });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('menu', 'save'));
  const confirm = win.getByTestId('confirm-dialog');
  await expect(confirm).toContainText("signed.pdf is signed. The new file won't be");
  await confirm.getByRole('button', { name: 'Save without the signatures' }).click();
  await expect(win.getByTestId('review-dialog')).toContainText('1 signature was left out, with its box');
  await passReview(win);
  await expect(win.getByTestId('message')).toContainText('Saved unsigned copy.pdf');
  const after = await inspectPdf({ id: 'x', name: 'x.pdf', bytes: read(target) });
  expect(after.carries.signatures).toEqual([]);
  expect(await checkSignatures(read(target), [])).toEqual([]);
});

test('make a certificate: it is saved where chosen, opens with its password, and is ready to sign with', async ({}, info) => {
  const run = (current = await launch(info.project.name));
  const { app, win, userData } = run;
  await openFixture(run, 'normal.pdf');
  await waitForFirstPage(win);
  const target = path.join(outDir(), 'Pat Tester.pfx');
  await answerDialogs(app, { saveAs: target });
  await goTo(win, 'Sign');
  await screen(win).getByRole('button', { name: 'Make a certificate…' }).click();
  const make = win.getByTestId('make-certificate-dialog');
  await make.getByLabel('Name on the certificate').fill('Pat Tester');
  await make.getByLabel('Email address (optional)').fill('pat@example.com');
  await make.getByLabel(/^Password for the certificate file/).fill('short');
  await make.getByLabel('The password again').fill('short');
  await make.getByRole('button', { name: 'Make and save…' }).click();
  await expect(make.getByRole('alert')).toHaveText('The password needs at least 8 characters.');
  await make.getByLabel(/^Password for the certificate file/).fill('made-in-a-test');
  await make.getByLabel('The password again').fill('made-in-a-test');
  await make.getByRole('button', { name: 'Make and save…' }).click();
  await expect(win.getByTestId('message')).toContainText('Saved your certificate as Pat Tester.pfx', { timeout: 30_000 });
  expect(existsSync(target)).toBe(true);
  const { key, chain } = await readPfx(read(target), 'made-in-a-test');
  expect(key.asymmetricKeyType).toBe('rsa');
  expect(chain).toHaveLength(1);
  expect(certificateDer(chain[0]).length).toBeGreaterThan(500);
  // Next time, signing starts with it.
  await screen(win).getByRole('button', { name: 'Sign this file…' }).click();
  await expect(dialog(win).getByTestId('certificate-file')).toHaveText('Pat Tester.pfx');
  await dialog(win).getByRole('button', { name: 'Cancel' }).click();
  // Its password is never written anywhere (checked once the app has closed its files).
  await closeApp(app);
  current = null;
  for (const file of filesIn(userData)) expect(readFileSync(file).includes(Buffer.from('made-in-a-test')), file).toBe(false);
});

test('screenshots of the Sign screen and the signing window in every theme', async ({}, info) => {
  test.setTimeout(300_000);
  mkdirSync(SCREENS, { recursive: true });
  const run = (current = await launch(info.project.name));
  const { app, win } = run;
  await win.setViewportSize({ width: 1280, height: 800 });
  await openFixture(run, 'signed-twice.pdf');
  await waitForFirstPage(win);
  // One signature confirmed (Sam Example trusted), the other not, so both kinds show.
  await goTo(win, 'Sign');
  await screen(win).getByTestId('signature').nth(1).getByRole('button', { name: 'Trust this certificate…' }).click();
  await win.getByTestId('confirm-dialog').getByRole('button', { name: 'Trust it' }).click();
  await expect(screen(win).getByTestId('trusted-list')).toBeVisible();
  const rows: string[][] = [];
  for (const theme of THEME_CHOICES) {
    await setTheme(win, theme.id);
    const row: string[] = [];
    const shot = async (name: string) => {
      await win.waitForTimeout(300);
      const file = path.join(SCREENS, `${theme.id}-sign-${name}.png`);
      await win.screenshot({ path: file });
      row.push(file);
    };
    await goTo(win, 'Sign');
    await shot('screen');
    await goTo(win, 'Document');
    await shot('document');
    await answerDialogs(app, { open: [path.join(FIXTURES, 'test-signer.pfx')] });
    await goTo(win, 'Sign');
    await screen(win).getByRole('button', { name: 'Sign this file…' }).click();
    await dialog(win).getByRole('button', { name: /^Choose (a certificate file|another file)…$/ }).click();
    await expect(dialog(win).getByTestId('certificate-file')).toHaveText('test-signer.pfx');
    await dialog(win).getByLabel('Password for the certificate file').fill(TEST_PFX_PASSWORD);
    await dialog(win).getByRole('button', { name: 'Next' }).click();
    await dialog(win).getByTestId('certificate-summary').waitFor();
    await shot('dialog');
    await dialog(win).getByRole('button', { name: 'Draw the box…' }).click();
    await win.getByTestId('placing-banner').waitFor();
    await shot('placing');
    await win.getByTestId('placing-banner').getByRole('button', { name: 'Cancel signing' }).click();
    rows.push(row);
  }
  const scale = 0.3;
  const w = Math.round(1280 * scale);
  const h = Math.round(800 * scale);
  const columns = 4;
  const sheet = createCanvas(w * columns + 10 * (columns + 1), (h + 10) * rows.length + 10);
  const g = sheet.getContext('2d');
  g.fillStyle = '#808080';
  g.fillRect(0, 0, sheet.width, sheet.height);
  for (const [r, row] of rows.entries()) for (const [c, file] of row.entries()) g.drawImage(await loadImage(file), 10 + c * (w + 10), 10 + r * (h + 10), w, h);
  writeFileSync(path.join(SCREENS, 'contact-sheet-sign.png'), sheet.toBuffer('image/png'));
});
