// Stop 4a: automatic backups to a backup folder, driven through the real app (docs/Plan_Phase4.md,
// section 7). Each "PC" is ScribeForge with a data folder of its own; a temporary folder stands in
// for OneDrive (the real one is never seen by tests). Turning backups on makes the first backup;
// locking or closing makes one only when something changed; nothing in the folder is readable;
// erasing for good reaches the folder; another PC restores from the folder and carries on; the
// first PC is then offered the newer backup; a missing folder never holds up locking.
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { THEME_CHOICES } from '../../src/shared/themes';
import { answerDialogs, closeApp, FIXTURES, fixtureHashes, launch, SCREENS, setTheme, type Running } from './helpers';

const PASSWORD = 'a test vault password';
const FOLDER = 'ScribeForge Archive backup';
let running: Running[] = [];
test.afterEach(async () => {
  for (const r of running) await closeApp(r.app).catch(() => {});
  running = [];
});
let hashesBefore: Record<string, string>;
test.beforeAll(() => {
  hashesBefore = fixtureHashes();
});
test.afterAll(() => {
  expect(fixtureHashes()).toEqual(hashesBefore);
});

const screen = (win: Page) => win.getByTestId('archive-screen');
const backupsIn = (oneDrive: string) => {
  const dir = path.join(oneDrive, FOLDER, 'backups');
  return existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith('.sfsnap')) : [];
};
const storedIn = (oneDrive: string) => readdirSync(path.join(oneDrive, FOLDER, 'files')).filter((n) => n.endsWith('.sealed'));
const filesIn = (folder: string): string[] =>
  readdirSync(folder).flatMap((f) => (statSync(path.join(folder, f)).isDirectory() ? filesIn(path.join(folder, f)) : [path.join(folder, f)]));

/** Starts a "PC": ScribeForge with its own data folder, and `oneDrive` as its OneDrive. */
async function pc(info: { project: { name: string } }, userData: string, oneDrive: string): Promise<Running> {
  const run = await launch(info.project.name, userData, { OneDrive: oneDrive });
  running.push(run);
  return run;
}

async function goToArchive(win: Page) {
  await win.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Archive', exact: true }).click();
}

async function makeVault(win: Page) {
  await goToArchive(win);
  await screen(win).getByLabel(/^Password \(at least 10 characters\)/).fill(PASSWORD);
  await screen(win).getByLabel('The password again').fill(PASSWORD);
  await screen(win).getByLabel('Also make a recovery code, in case I forget the password').uncheck();
  await screen(win).getByRole('button', { name: 'Make the vault' }).click();
  await expect(screen(win).getByTestId('vault-empty')).toBeVisible();
}

async function unlock(win: Page) {
  await goToArchive(win);
  await screen(win).getByLabel('Password', { exact: true }).fill(PASSWORD);
  await screen(win).getByRole('button', { name: 'Unlock' }).click();
  await expect(screen(win).getByRole('button', { name: 'Lock' })).toBeVisible();
}

async function add(app: ElectronApplication, win: Page, name: string) {
  await answerDialogs(app, { open: [path.join(FIXTURES, name)] });
  await screen(win).getByRole('button', { name: 'Add PDFs…' }).click();
  await expect(win.getByTestId('message')).toContainText('to the Archive');
}

async function turnOn(win: Page, oneDrive: string) {
  await screen(win).getByRole('button', { name: 'Turn on automatic backups…' }).click();
  const dialog = win.getByTestId('backup-place-dialog');
  await expect(dialog.getByLabel(/^OneDrive/)).toBeChecked();
  await expect(dialog).toContainText(oneDrive);
  await dialog.getByRole('button', { name: 'Turn on' }).click();
  await expect(win.getByTestId('message')).toContainText('Automatic backups are on.');
  await expect(screen(win).getByTestId('backup-status')).toContainText('Last backup:');
}

test('backups to OneDrive: the first when turned on, then only when something changed; nothing readable; erasing reaches the folder', async ({}, info) => {
  const oneDrive = mkdtempSync(path.join(tmpdir(), 'scribeforge-e2e-onedrive-'));
  const { app, win } = await pc(info, mkdtempSync(path.join(tmpdir(), 'scribeforge-e2e-')), oneDrive);
  await makeVault(win);
  await add(app, win, 'normal.pdf');
  await turnOn(win, oneDrive);
  await expect(screen(win).getByTestId('automatic-backups')).toContainText(`In OneDrive: ${path.join(oneDrive, FOLDER)}`);
  expect(readFileSync(path.join(oneDrive, FOLDER, 'README.txt'), 'utf8')).toContain('encrypted backups of a ScribeForge Archive');
  expect(backupsIn(oneDrive)).toHaveLength(1);
  expect(storedIn(oneDrive)).toHaveLength(1);

  // Locking with nothing changed: no new backup.
  await screen(win).getByRole('button', { name: 'Lock' }).click();
  await unlock(win);
  expect(backupsIn(oneDrive)).toHaveLength(1);

  // Something changed: locking makes one, and only the new document's file is copied.
  await add(app, win, 'links.pdf');
  await screen(win).getByRole('button', { name: 'Lock' }).click();
  await expect.poll(() => backupsIn(oneDrive).length).toBe(2);
  expect(storedIn(oneDrive)).toHaveLength(2);
  await unlock(win);
  await expect(screen(win).getByTestId('backup-status')).toContainText('Last backup:');

  // Nothing in the folder can be read.
  for (const file of filesIn(oneDrive)) {
    const bytes = readFileSync(file);
    for (const secret of ['ScribeForge test document', 'anvil', 'normal.pdf', 'links.pdf', PASSWORD]) expect(bytes.includes(Buffer.from(secret)), `${path.basename(file)}: ${secret}`).toBe(false);
  }

  // Erase for good: gone from the folder too.
  await screen(win).getByRole('list', { name: 'Documents' }).getByRole('button', { name: /ScribeForge test document/ }).click();
  await screen(win).getByTestId('vault-panel').getByRole('button', { name: 'Erase for good…' }).click();
  await expect(win.getByTestId('erase-dialog')).toContainText("It's removed from automatic backups too.");
  await win.getByTestId('erase-dialog').getByLabel('Reason').fill('Stored by mistake');
  await win.getByTestId('erase-dialog').getByRole('button', { name: 'Erase it for good' }).click();
  await win.getByTestId('confirm-dialog').getByRole('button', { name: 'Erase it' }).click();
  await expect(win.getByTestId('message')).toContainText('was erased from the vault and from the backup folder.');
  expect(storedIn(oneDrive)).toHaveLength(1);
  expect(backupsIn(oneDrive)).toHaveLength(1); // only the one made after erasing

  // Back up now, and how many to keep.
  await screen(win).getByRole('combobox', { name: 'Backups to keep' }).selectOption('5');
  await screen(win).getByRole('button', { name: 'Back up now' }).click();
  await expect.poll(() => backupsIn(oneDrive).length).toBe(2);
  await screen(win).getByRole('button', { name: 'Turn off' }).click();
  await expect(screen(win).getByTestId('backup-status')).toContainText('Off.');
});

test('another PC restores from the backup folder and carries on; closing makes a backup; the first PC is offered the newer one', async ({}, info) => {
  test.setTimeout(120_000);
  const oneDrive = mkdtempSync(path.join(tmpdir(), 'scribeforge-e2e-onedrive-'));
  const first = mkdtempSync(path.join(tmpdir(), 'scribeforge-e2e-pc1-'));
  const second = mkdtempSync(path.join(tmpdir(), 'scribeforge-e2e-pc2-'));

  // The first PC: a vault with one document, backed up.
  let run = await pc(info, first, oneDrive);
  await makeVault(run.win);
  await add(run.app, run.win, 'normal.pdf');
  await turnOn(run.win, oneDrive);
  await closeApp(run.app);
  running = [];

  // The second PC: no vault yet. It restores from the folder (choosing OneDrive itself is enough).
  run = await pc(info, second, oneDrive);
  await goToArchive(run.win);
  await answerDialogs(run.app, { folder: oneDrive });
  await screen(run.win).getByRole('button', { name: 'Restore from a backup folder…' }).click();
  const restore = run.win.getByTestId('restore-backup-dialog');
  await expect(restore).toContainText('The newest complete backup in the backup folder');
  await restore.locator('input[type="password"]').fill(PASSWORD);
  await restore.getByRole('button', { name: 'Check the backup' }).click();
  await expect(restore.getByTestId('backup-checked')).toContainText('The backup is complete. It was made on');
  await expect(restore.getByTestId('backup-checked')).toContainText('holds 1 document. Each stored file is checked as it\'s restored.');
  await restore.getByRole('button', { name: 'Restore it' }).click();
  await expect(run.win.getByTestId('message')).toContainText('The vault was restored from the backup: 1 document.');
  await run.win.getByTestId('confirm-dialog').getByRole('button', { name: 'Keep backing up' }).click();
  await expect(screen(run.win).getByTestId('backup-status')).not.toContainText('Off.');
  expect(backupsIn(oneDrive)).toHaveLength(1); // nothing new to back up yet
  await add(run.app, run.win, 'links.pdf');
  // Closing ScribeForge makes the backup, and waits for it.
  await closeApp(run.app);
  running = [];
  expect(backupsIn(oneDrive)).toHaveLength(2);

  // The first PC again: offered the newer backup, made on the other PC.
  run = await pc(info, first, oneDrive);
  await unlock(run.win);
  const newer = screen(run.win).getByTestId('newer-backup');
  await expect(newer).toContainText("There's a newer backup of this vault in the backup folder, made on another PC on");
  await expect(newer).not.toContainText('This vault has changes too');
  // Not now: gone until the vault next locks.
  await newer.getByRole('button', { name: 'Not now' }).click();
  await expect(newer).toHaveCount(0);
  await screen(run.win).getByRole('button', { name: 'Lock' }).click();
  await unlock(run.win);
  await newer.getByRole('button', { name: 'Restore it…' }).click();
  const again = run.win.getByTestId('restore-backup-dialog');
  await again.locator('input[type="password"]').fill(PASSWORD);
  await again.getByRole('button', { name: 'Check the backup' }).click();
  await expect(again.getByTestId('backup-checked')).toContainText('holds 2 documents');
  await again.getByRole('button', { name: 'Replace the vault with it' }).click();
  await expect(run.win.getByTestId('message')).toContainText('The vault was restored from the backup: 2 documents.');
  await expect(screen(run.win).getByTestId('newer-backup')).toHaveCount(0);
  await expect(screen(run.win).getByRole('list', { name: 'Documents' }).getByRole('listitem')).toHaveCount(2);
});

test('a backup folder that has gone never holds up locking; the Archive says so; a document erased meanwhile leaves the folder when it is back', async ({}, info) => {
  const oneDrive = mkdtempSync(path.join(tmpdir(), 'scribeforge-e2e-onedrive-'));
  const away = `${oneDrive} away`;
  const { app, win } = await pc(info, mkdtempSync(path.join(tmpdir(), 'scribeforge-e2e-')), oneDrive);
  await makeVault(win);
  await add(app, win, 'normal.pdf');
  await turnOn(win, oneDrive);
  const [normalFile] = storedIn(oneDrive);
  renameSync(oneDrive, away); // OneDrive taken off this PC, or a USB drive unplugged
  await add(app, win, 'links.pdf');
  await screen(win).getByRole('button', { name: 'Lock' }).click();
  await expect(screen(win).getByLabel('Password', { exact: true })).toBeVisible();
  await unlock(win);
  await expect(screen(win).getByTestId('backup-status')).toContainText("The last backup didn't work. The backup folder isn't there.");
  expect(existsSync(oneDrive)).toBe(false); // nothing was made in its place

  // Erased while the folder is away: it leaves the folder at the next backup that reaches it.
  await screen(win).getByRole('list', { name: 'Documents' }).getByRole('button', { name: /ScribeForge test document/ }).click();
  await screen(win).getByTestId('vault-panel').getByRole('button', { name: 'Erase for good…' }).click();
  await win.getByTestId('erase-dialog').getByLabel('Reason').fill('Stored by mistake');
  await win.getByTestId('erase-dialog').getByRole('button', { name: 'Erase it for good' }).click();
  await win.getByTestId('confirm-dialog').getByRole('button', { name: 'Erase it' }).click();
  await expect(win.getByTestId('message')).toContainText('was erased from the vault.');
  await expect(win.getByTestId('message')).not.toContainText('backup folder');
  renameSync(away, oneDrive);
  expect(storedIn(oneDrive)).toContain(normalFile);
  await screen(win).getByRole('button', { name: 'Back up now' }).click();
  await expect(screen(win).getByTestId('backup-status')).toContainText('Last backup:');
  await expect.poll(() => storedIn(oneDrive)).not.toContain(normalFile);
  expect(storedIn(oneDrive)).toHaveLength(1);
  expect(backupsIn(oneDrive)).toHaveLength(1); // the one that held it is gone
});

test('screenshots of automatic backups in every theme', async ({}, info) => {
  test.setTimeout(300_000);
  mkdirSync(SCREENS, { recursive: true });
  const oneDrive = mkdtempSync(path.join(tmpdir(), 'scribeforge-e2e-onedrive-'));
  const { app, win } = await pc(info, mkdtempSync(path.join(tmpdir(), 'scribeforge-e2e-')), oneDrive);
  await win.setViewportSize({ width: 1280, height: 800 });
  await makeVault(win);
  await add(app, win, 'normal.pdf');
  await turnOn(win, oneDrive);
  // A newer backup "from another PC": this PC's own, renamed as if another had made it.
  const backups = path.join(oneDrive, FOLDER, 'backups');
  const [mine] = readdirSync(backups);
  const later = mine.replace(/^\d{4}-\d{2}-\d{2}T[\d-]+Z/, new Date(Date.now() + 60_000).toISOString().replace(/[:.]/g, '-')).replace(/_[0-9a-f]{12}\.sfsnap$/, '_cccccccccccc.sfsnap');
  writeFileSync(path.join(backups, later), readFileSync(path.join(backups, mine)));
  const rows: string[][] = [];
  for (const theme of THEME_CHOICES) {
    await setTheme(win, theme.id);
    const row: string[] = [];
    const shot = async (name: string) => {
      await win.waitForTimeout(400);
      const file = path.join(SCREENS, `${theme.id}-backups-${name}.png`);
      await win.screenshot({ path: file });
      row.push(file);
    };
    await goToArchive(win);
    await screen(win).getByTestId('automatic-backups').scrollIntoViewIfNeeded();
    await shot('on');
    await screen(win).getByRole('button', { name: 'Change the folder…' }).click();
    await expect(win.getByTestId('backup-place-dialog').getByLabel(/^OneDrive/)).toBeVisible();
    await shot('dialog');
    await win.getByTestId('backup-place-dialog').getByRole('button', { name: 'Cancel' }).click();
    await screen(win).getByRole('button', { name: 'Lock' }).click();
    await unlock(win);
    await expect(screen(win).getByTestId('newer-backup')).toBeVisible();
    await screen(win).getByTestId('newer-backup').scrollIntoViewIfNeeded();
    await shot('newer');
    rows.push(row);
  }
  const scale = 0.3;
  const w = Math.round(1280 * scale);
  const h = Math.round(800 * scale);
  const columns = 3;
  const sheet = createCanvas(w * columns + 10 * (columns + 1), (h + 10) * rows.length + 10);
  const g = sheet.getContext('2d');
  g.fillStyle = '#808080';
  g.fillRect(0, 0, sheet.width, sheet.height);
  for (const [r, row] of rows.entries()) for (const [c, file] of row.entries()) g.drawImage(await loadImage(file), 10 + c * (w + 10), 10 + r * (h + 10), w, h);
  writeFileSync(path.join(SCREENS, 'contact-sheet-backups.png'), sheet.toBuffer('image/png'));
});
