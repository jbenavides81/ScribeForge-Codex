// Stop 3a: the Archive's vault, driven through the real app (docs/Plan_Phase3.md, section 5):
// making it, adding and opening PDFs, nothing readable on disk, locking (Lock, Windows locking,
// sleep and idle) closing what was opened from it, the recovery code, void, restore and erase,
// the history, backups, and keeping a copy when saving.
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { THEME_CHOICES } from '../../src/shared/themes';
import { answerDialogs, blockedRequests, closeApp, FIXTURES, fixtureHashes, launch, openFixture, passReview, SCREENS, setTheme, waitForFirstPage, type Running } from './helpers';

const PASSWORD = 'a test vault password';
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
const screen = (win: Page) => win.getByTestId('archive-screen');
const filesIn = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => (statSync(path.join(dir, f)).isDirectory() ? filesIn(path.join(dir, f)) : [path.join(dir, f)]));

async function goToArchive(win: Page) {
  await win.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Archive', exact: true }).click();
}

/** Makes the vault; returns the recovery code if one was made. */
async function makeVault(win: Page, withCode = false): Promise<string | null> {
  await goToArchive(win);
  await screen(win).getByLabel(/^Password \(at least 10 characters\)/).fill(PASSWORD);
  await screen(win).getByLabel('The password again').fill(PASSWORD);
  const tick = screen(win).getByLabel('Also make a recovery code, in case I forget the password');
  if ((await tick.isChecked()) !== withCode) await tick.click();
  await screen(win).getByRole('button', { name: 'Make the vault' }).click();
  let code: string | null = null;
  if (withCode) {
    const dialog = win.getByTestId('recovery-code-dialog');
    code = (await dialog.getByTestId('recovery-code').textContent())?.trim() ?? null;
    await dialog.getByLabel("I've written it down somewhere safe").check();
    await dialog.getByRole('button', { name: 'Done' }).click();
  }
  await expect(screen(win).getByTestId('vault-empty')).toBeVisible();
  return code;
}

async function addFixtures(app: ElectronApplication, win: Page, names: string[]) {
  await answerDialogs(app, { open: names.map((n) => path.join(FIXTURES, n)) });
  await screen(win).getByRole('button', { name: 'Add PDFs…' }).click();
  await expect(win.getByTestId('message')).toContainText(names.length === 1 ? 'to the Archive' : `Added ${names.length} documents to the Archive.`);
}

const item = (win: Page, title: string) => screen(win).getByRole('list', { name: 'Documents' }).getByRole('button', { name: new RegExp(title) });

test('make the vault, add PDFs with labels and a note: nothing in the vault folder can be read; the recovery code opens it', async ({}, info) => {
  const run = (current = await launch(info.project.name));
  const { app, win, userData } = run;
  const code = await makeVault(win, true);
  expect(code).toMatch(/^[0-9A-Z]{5}(-[0-9A-Z]{5}){4}$/);
  await addFixtures(app, win, ['carries.pdf', 'normal.pdf']);
  await expect(item(win, 'CARRIES-OLD-TITLE')).toBeVisible();
  await expect(item(win, 'ScribeForge test document')).toBeVisible();
  await expect(screen(win).getByTestId('vault-size')).toContainText('2 documents');

  await item(win, 'CARRIES-OLD-TITLE').click();
  const panel = screen(win).getByTestId('vault-panel');
  await panel.getByLabel('Labels, separated with commas').fill('VAULT-LABEL-ONE, tax');
  await panel.getByLabel('Note', { exact: true }).click();
  await panel.getByLabel('Note', { exact: true }).fill('VAULT-NOTE-TEXT');
  await panel.getByLabel('Title').click();
  await expect(item(win, 'CARRIES-OLD-TITLE')).toContainText('VAULT-LABEL-ONE, tax');
  const labelFilter = screen(win).getByRole('combobox', { name: /^Label/ });
  await labelFilter.selectOption('tax');
  await expect(screen(win).getByRole('list', { name: 'Documents' }).getByRole('listitem')).toHaveCount(1);
  await labelFilter.selectOption('');

  await screen(win).getByRole('button', { name: 'Lock' }).click();
  await expect(screen(win).getByText('The vault is locked')).toBeVisible();

  // Nothing readable on disk: no titles, labels, note or file names, and no piece of the stored PDFs.
  const vaultFiles = filesIn(path.join(userData, 'Vault'));
  const original = readFileSync(path.join(FIXTURES, 'normal.pdf'));
  const pieces = [0.2, 0.4, 0.6, 0.8].map((at) => original.subarray(Math.floor(original.length * at), Math.floor(original.length * at) + 24));
  for (const file of vaultFiles) {
    const bytes = readFileSync(file);
    for (const text of ['CARRIES-OLD-TITLE', 'ScribeForge test document', 'VAULT-LABEL-ONE', 'VAULT-NOTE-TEXT', 'carries.pdf', 'normal.pdf', PASSWORD]) expect(bytes.includes(Buffer.from(text)), `${text} in ${file}`).toBe(false);
    for (const piece of pieces) expect(bytes.includes(piece), `a piece of normal.pdf in ${file}`).toBe(false);
  }

  await screen(win).getByRole('button', { name: 'Use the recovery code instead' }).click();
  await screen(win).getByLabel('Recovery code').fill((code as string).toLowerCase());
  await screen(win).getByRole('button', { name: 'Unlock' }).click();
  await expect(win.getByTestId('message')).toContainText('opened with the recovery code');
  await expect(item(win, 'CARRIES-OLD-TITLE')).toBeVisible();
  expect(await blockedRequests(app)).toEqual([]);

  // The password and the code are never written anywhere, and nothing decrypted is written anywhere
  // in the app's data folder either (checked once the app has closed its files).
  await closeApp(app);
  current = null;
  for (const file of filesIn(userData)) {
    const bytes = readFileSync(file);
    for (const text of [PASSWORD, code as string, 'CARRIES-OLD-TITLE', 'VAULT-LABEL-ONE', 'VAULT-NOTE-TEXT']) expect(bytes.includes(Buffer.from(text)), `${text} in ${file}`).toBe(false);
  }
});

test('a document opened from the vault closes when the vault locks: Lock, Windows locking and sleep', async ({}, info) => {
  const run = (current = await launch(info.project.name));
  const { app, win } = run;
  await makeVault(win);
  await addFixtures(app, win, ['normal.pdf']);
  const reopen = async () => {
    await item(win, 'ScribeForge test document').click();
    await screen(win).getByTestId('vault-panel').getByRole('button', { name: 'Open', exact: true }).click();
    await waitForFirstPage(win);
    await expect(win.locator('.sf-doc-name')).toHaveText('normal.pdf');
  };
  const unlock = async () => {
    await screen(win).getByLabel('Password', { exact: true }).fill(PASSWORD);
    await screen(win).getByRole('button', { name: 'Unlock' }).click();
    await expect(item(win, 'ScribeForge test document')).toBeVisible();
  };
  for (const [signal, note] of [
    ['lock-screen', 'because Windows locked'],
    ['suspend', 'because the PC went to sleep'],
  ] as const) {
    await reopen();
    await app.evaluate(({ powerMonitor }, s) => powerMonitor.emit(s), signal);
    await expect(win.getByTestId('message')).toContainText('The Archive locked, so the document opened from it was closed.');
    await expect(screen(win).getByTestId('vault-locked-note')).toContainText(note);
    await expect(win.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Document', exact: true })).toBeDisabled();
    await unlock();
  }
  // A file opened from disk stays open when the vault locks.
  await openFixture(run, 'links.pdf');
  await waitForFirstPage(win);
  await app.evaluate(({ powerMonitor }) => powerMonitor.emit('lock-screen'));
  await goToArchive(win);
  await expect(screen(win).getByTestId('vault-locked-note')).toBeVisible();
  await expect(win.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Document', exact: true })).toBeEnabled();
});

test('the vault locks itself when ScribeForge is not used for the set time', async ({}, info) => {
  const run = (current = await launch(info.project.name, undefined, { SCRIBEFORGE_TEST_VAULT_IDLE_MS: '1500' }));
  const { win } = run;
  await makeVault(win);
  await expect(screen(win).getByTestId('vault-locked-note')).toContainText("because ScribeForge wasn't used for a while", { timeout: 10_000 });
});

test('void hides and keeps, restore brings back, erase removes for good; the history records it all and is intact', async ({}, info) => {
  const run = (current = await launch(info.project.name));
  const { app, win } = run;
  await makeVault(win);
  await addFixtures(app, win, ['normal.pdf']);
  await item(win, 'ScribeForge test document').click();
  const panel = screen(win).getByTestId('vault-panel');

  await panel.getByRole('button', { name: 'Void…' }).click();
  await win.getByTestId('void-dialog').getByLabel('Reason').fill('Superseded');
  await win.getByTestId('void-dialog').getByRole('button', { name: 'Void it' }).click();
  await expect(item(win, 'ScribeForge test document')).toHaveCount(0);
  await screen(win).getByLabel('Show voided documents').check();
  await expect(item(win, 'ScribeForge test document')).toContainText('Voided');
  await item(win, 'ScribeForge test document').click();
  await expect(panel).toContainText('Reason: Superseded');
  await panel.getByRole('button', { name: 'Restore' }).click();
  await expect(item(win, 'ScribeForge test document')).not.toContainText('Voided');

  await panel.getByRole('button', { name: 'Erase for good…' }).click();
  const erase = win.getByTestId('erase-dialog');
  await expect(erase).toContainText("Backup files you've saved yourself aren't touched");
  await erase.getByLabel('Reason').fill('Stored by mistake');
  await erase.getByRole('button', { name: 'Erase it for good' }).click();
  await win.getByTestId('confirm-dialog').getByRole('button', { name: 'Erase it' }).click();
  await expect(screen(win).getByTestId('vault-empty')).toBeVisible();

  await screen(win).getByRole('radio', { name: 'History' }).click();
  const history = screen(win).getByTestId('vault-history');
  await expect(history.getByTestId('history-state')).toContainText('The history is intact: 5 entries');
  for (const line of ['The vault was made.', '“ScribeForge test document” was added.', 'was voided. Reason: Superseded', 'was restored.', 'was erased for good. Reason: Stored by mistake']) {
    await expect(history).toContainText(line);
  }
  const saved = path.join(outDir(), 'history.txt');
  await answerDialogs(app, { saveAs: saved });
  await history.getByRole('button', { name: 'Save as a text file…' }).click();
  await expect(win.getByTestId('message')).toContainText('Saved the history as history.txt');
  expect(readFileSync(saved, 'utf8')).toContain('5. ');
});

test('a backup restores the vault exactly, after its password checks every part of it', async ({}, info) => {
  const run = (current = await launch(info.project.name));
  const { app, win } = run;
  await makeVault(win);
  await addFixtures(app, win, ['normal.pdf']);
  const backup = path.join(outDir(), 'vault.sfbackup');
  await answerDialogs(app, { saveAs: backup, open: [backup] });
  await screen(win).getByRole('button', { name: 'Make a backup…' }).click();
  await expect(win.getByTestId('message')).toContainText('Saved the backup as vault.sfbackup');
  expect(readFileSync(backup).includes(Buffer.from('ScribeForge test document'))).toBe(false);

  await item(win, 'ScribeForge test document').click();
  await screen(win).getByTestId('vault-panel').getByRole('button', { name: 'Erase for good…' }).click();
  await win.getByTestId('erase-dialog').getByLabel('Reason').fill('Testing backups');
  await win.getByTestId('erase-dialog').getByRole('button', { name: 'Erase it for good' }).click();
  await win.getByTestId('confirm-dialog').getByRole('button', { name: 'Erase it' }).click();
  await expect(screen(win).getByTestId('vault-empty')).toBeVisible();

  await screen(win).getByRole('button', { name: 'Restore a backup…' }).click();
  const restore = win.getByTestId('restore-backup-dialog');
  const secret = restore.locator('input[type="password"]');
  await secret.fill('not the password');
  await restore.getByRole('button', { name: 'Check the backup' }).click();
  await expect(restore.getByRole('alert')).toContainText("That password doesn't open this backup.");
  await secret.fill(PASSWORD);
  await restore.getByRole('button', { name: 'Check the backup' }).click();
  await expect(restore.getByTestId('backup-checked')).toContainText('holds 1 document');
  await restore.getByRole('button', { name: 'Replace the vault with it' }).click();
  await expect(win.getByTestId('message')).toContainText('The vault was restored from the backup: 1 document.');
  await expect(item(win, 'ScribeForge test document')).toBeVisible();
});

test('saving a new file can also keep a copy in the Archive', async ({}, info) => {
  const run = (current = await launch(info.project.name));
  const { app, win } = run;
  await makeVault(win);
  await openFixture(run, 'links.pdf');
  await waitForFirstPage(win);
  const target = path.join(outDir(), 'links kept.pdf');
  await answerDialogs(app, { saveAs: target });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('menu', 'save'));
  await win.getByTestId('review-dialog').getByLabel('Also keep a copy in the Archive').check();
  await passReview(win);
  await expect(win.getByTestId('message')).toContainText('A copy is also in the Archive.');
  await goToArchive(win);
  await expect(screen(win).getByRole('list', { name: 'Documents' }).getByRole('listitem')).toHaveCount(1);
  await expect(screen(win).getByTestId('vault-size')).toContainText('1 document');
});

test('screenshots of the Archive in every theme', async ({}, info) => {
  test.setTimeout(300_000);
  mkdirSync(SCREENS, { recursive: true });
  const run = (current = await launch(info.project.name));
  const { app, win } = run;
  await win.setViewportSize({ width: 1280, height: 800 });
  await makeVault(win);
  await addFixtures(app, win, ['carries.pdf', 'normal.pdf', 'links.pdf']);
  await item(win, 'CARRIES-OLD-TITLE').click();
  await screen(win).getByTestId('vault-panel').getByLabel('Labels, separated with commas').fill('Contracts, 2026');
  await screen(win).getByTestId('vault-panel').getByLabel('Title').click();
  const rows: string[][] = [];
  for (const theme of THEME_CHOICES) {
    await setTheme(win, theme.id);
    const row: string[] = [];
    const shot = async (name: string) => {
      await win.waitForTimeout(400);
      const file = path.join(SCREENS, `${theme.id}-archive-${name}.png`);
      await win.screenshot({ path: file });
      row.push(file);
    };
    await goToArchive(win);
    await item(win, 'CARRIES-OLD-TITLE').click();
    await shot('documents');
    await screen(win).getByLabel('Search the Archive').fill('anvil');
    await screen(win).getByRole('button', { name: 'Search', exact: true }).click();
    await screen(win).getByTestId('search-results').waitFor();
    await shot('search');
    await screen(win).getByLabel('Search the Archive').fill('');
    await screen(win).getByRole('radio', { name: 'History' }).click();
    await shot('history');
    await screen(win).getByRole('radio', { name: 'Documents' }).click();
    await screen(win).getByRole('button', { name: 'Lock' }).click();
    await shot('locked');
    await screen(win).getByLabel('Password', { exact: true }).fill(PASSWORD);
    await screen(win).getByRole('button', { name: 'Unlock' }).click();
    await expect(item(win, 'CARRIES-OLD-TITLE')).toBeVisible();
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
  writeFileSync(path.join(SCREENS, 'contact-sheet-archive.png'), sheet.toBuffer('image/png'));
});
