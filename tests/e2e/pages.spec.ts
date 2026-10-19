// Stop 1b: the Pages screen, driven through the real app. Every saved file is then checked with
// the same inspectors as the engine's unit tests.
import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { bookmarks, findEverywhere, pageIds, pageTexts, rotations, strayPages } from '../unit/support/inspect';
import {
  answerDialogs,
  blockedRequests,
  closeApp,
  dialogLog,
  FIXTURES,
  fixtureHashes,
  goTo,
  launch,
  openFixture,
  passReview,
  waitForFirstPage,
  type Running,
} from './helpers';

let hashesBefore: Record<string, string>;
test.beforeAll(() => {
  hashesBefore = fixtureHashes();
});
test.afterAll(() => {
  expect(fixtureHashes()).toEqual(hashesBefore);
});

const outDir = () => mkdtempSync(path.join(tmpdir(), 'scribeforge-e2e-out-'));
const read = (p: string) => new Uint8Array(readFileSync(p));
const sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');
const tile = (win: Page, n: number) => win.getByRole('option', { name: new RegExp(`^Page ${n}(,|$)`) });
const status = (win: Page) => win.getByTestId('pages-status');

async function openInPages(run: Running, name: string): Promise<void> {
  await openFixture(run, name);
  await waitForFirstPage(run.win);
  await goTo(run.win, 'Pages');
  await expect(run.win.locator('.sf-page-canvas[data-rendered]').first()).toBeAttached();
}

test('rotate, delete, drag to reorder, undo and redo, then save as a new file', async ({}, info) => {
  const run = await launch(info.project.name);
  const { app, win } = run;
  await openInPages(run, 'links.pdf');
  await expect(status(win)).toHaveText('6 pages · 0 selected · No changes');

  await tile(win, 1).click();
  await win.getByRole('button', { name: 'Rotate right' }).click();
  await tile(win, 6).click();
  await win.getByRole('button', { name: 'Delete' }).click();
  await expect(status(win)).toHaveText('5 pages · 0 selected · Changes not saved yet');

  // Drag page 3 to before page 1.
  await tile(win, 3).dragTo(tile(win, 1), { targetPosition: { x: 8, y: 60 } });
  await expect(tile(win, 1)).toHaveAccessibleName('Page 1, was page 3');
  await expect(tile(win, 2)).toHaveAccessibleName('Page 2, was page 1, turned 90°');

  await win.getByRole('button', { name: 'Undo' }).click();
  await expect(tile(win, 1)).toHaveAccessibleName('Page 1, turned 90°');
  await win.getByRole('button', { name: 'Redo' }).click();
  await expect(tile(win, 1)).toHaveAccessibleName('Page 1, was page 3');

  // The Document screen says the changes aren't in the file yet.
  await goTo(win, 'Document');
  await expect(win.getByTestId('pages-banner')).toBeVisible();
  await goTo(win, 'Pages');

  const target = path.join(outDir(), 'result.pdf');
  await answerDialogs(app, { saveAs: target });
  await win.getByRole('button', { name: 'Save as new file…' }).click();
  await passReview(win);
  await expect(win.getByTestId('message')).toContainText('Saved result.pdf (5 pages).');
  await expect(win.getByTestId('message')).toContainText('1 link and 1 bookmark pointed to pages that aren\'t in the new file');
  // The new file opens in place of the old one.
  await waitForFirstPage(win);
  await expect(win.locator('.sf-doc-name')).toHaveText('result.pdf');
  await expect(win.getByTestId('page-count')).toHaveText('of 5');

  const saved = await dialogLog(app);
  expect(saved.find((d) => d.kind === 'save')?.defaultPath).toBe(path.join(FIXTURES, 'links (edited).pdf'));
  const bytes = read(target);
  expect(await pageIds(bytes)).toEqual(['UNIQUE-PAGE-3', 'UNIQUE-PAGE-1', 'UNIQUE-PAGE-2', 'UNIQUE-PAGE-4', 'UNIQUE-PAGE-5']);
  expect(await rotations(bytes)).toEqual([0, 90, 90, 0, 0]);
  expect(await findEverywhere(bytes, 'UNIQUE-PAGE-6')).toEqual([]);
  expect(await strayPages(bytes)).toBe(0);
  expect(await blockedRequests(app)).toEqual([]);
  await closeApp(app);
});

test('add files to merge, nesting bookmarks under each file', async ({}, info) => {
  const run = await launch(info.project.name);
  const { app, win } = run;
  await openInPages(run, 'links.pdf');
  await answerDialogs(app, { open: [path.join(FIXTURES, 'second.pdf')] });
  await win.getByRole('button', { name: 'Add files…' }).click();
  await expect(status(win)).toContainText('8 pages · 2 selected');
  await expect(tile(win, 7)).toHaveAccessibleName('Page 7, second.pdf, page 1');

  const target = path.join(outDir(), 'merged.pdf');
  await answerDialogs(app, { saveAs: target });
  await win.getByRole('button', { name: 'Save as new file…' }).click();
  await passReview(win);
  await expect(win.getByTestId('message')).toContainText('Saved merged.pdf (8 pages).');
  expect((await dialogLog(app)).find((d) => d.kind === 'save')?.defaultPath).toBe(path.join(FIXTURES, 'links (merged).pdf'));
  const marks = await bookmarks(read(target));
  expect(marks.map((m) => [m.title, m.page])).toEqual([
    ['links', 1],
    ['second', 7],
  ]);
  await closeApp(app);
});

test('save selected pages as a new file, keeping the document open', async ({}, info) => {
  const run = await launch(info.project.name);
  const { app, win } = run;
  await openInPages(run, 'links.pdf');
  await tile(win, 2).click();
  await tile(win, 4).click({ modifiers: ['Control'] });
  const target = path.join(outDir(), 'some.pdf');
  await answerDialogs(app, { saveAs: target });
  await win.getByRole('button', { name: 'Save selected pages…' }).click();
  await passReview(win);
  await expect(win.getByTestId('message')).toContainText('Saved some.pdf (2 pages).');
  expect((await dialogLog(app)).find((d) => d.kind === 'save')?.defaultPath).toBe(path.join(FIXTURES, 'links (pages 2, 4).pdf'));
  expect(await pageIds(read(target))).toEqual(['UNIQUE-PAGE-2', 'UNIQUE-PAGE-4']);
  for (const n of [1, 3, 5, 6]) expect(await findEverywhere(read(target), `UNIQUE-PAGE-${n}`)).toEqual([]);
  await expect(status(win)).toContainText('6 pages · 2 selected');
  await goTo(win, 'Document');
  await expect(win.locator('.sf-doc-name')).toHaveText('links.pdf');
  await closeApp(app);
});

test('split into files in a chosen folder; ranges are checked first', async ({}, info) => {
  const run = await launch(info.project.name);
  const { app, win } = run;
  await openInPages(run, 'links.pdf');
  await win.getByRole('button', { name: 'Split…' }).click();
  const dialog = win.getByTestId('split-dialog');
  await dialog.getByLabel('Page ranges', { exact: true }).fill('5-2');
  await dialog.getByRole('button', { name: 'Choose a folder and split' }).click();
  await expect(dialog.getByRole('alert')).toContainText('runs backwards');
  await dialog.getByLabel('Page ranges', { exact: true }).fill('1-2, 3, 4-6');
  const folder = outDir();
  await answerDialogs(app, { folder });
  await dialog.getByRole('button', { name: 'Choose a folder and split' }).click();
  await passReview(win);
  await expect(win.getByTestId('message')).toContainText(`Split into 3 files in ${folder}.`);
  expect(readdirSync(folder).sort()).toEqual(['links (pages 1-2).pdf', 'links (pages 4-6).pdf', 'links (page 3).pdf'].sort());
  expect(await pageIds(read(path.join(folder, 'links (pages 4-6).pdf')))).toEqual(['UNIQUE-PAGE-4', 'UNIQUE-PAGE-5', 'UNIQUE-PAGE-6']);
  expect(await findEverywhere(read(path.join(folder, 'links (page 3).pdf')), 'UNIQUE-PAGE-4')).toEqual([]);

  // Splitting again into the same folder never overwrites: the new files get " 2".
  await win.getByRole('button', { name: 'Split…' }).click();
  await win.getByTestId('split-dialog').getByLabel('Every page as its own file').check();
  await win.getByTestId('split-dialog').getByRole('button', { name: 'Choose a folder and split' }).click();
  await passReview(win);
  await expect(win.getByTestId('message')).toContainText('Split into 6 files');
  expect(readdirSync(folder)).toContain('links (page 3) 2.pdf');
  await closeApp(app);
});

test('replacing the original file asks first; Cancel leaves it exactly as it was', async ({}, info) => {
  const run = await launch(info.project.name);
  const { app, win } = run;
  const dir = outDir();
  const original = path.join(dir, 'original.pdf');
  copyFileSync(path.join(FIXTURES, 'links.pdf'), original);
  const before = sha(original);
  await answerDialogs(app, { open: [original] });
  await goTo(win, 'Start');
  await win.getByRole('button', { name: 'Open a PDF…' }).click();
  await waitForFirstPage(win);
  await goTo(win, 'Pages');
  await tile(win, 1).click();
  await win.getByRole('button', { name: 'Rotate right' }).click();

  await answerDialogs(app, { saveAs: original, messageResponse: 1 });
  await win.getByRole('button', { name: 'Save as new file…' }).click();
  await passReview(win);
  await expect.poll(async () => (await dialogLog(app)).filter((d) => d.kind === 'message').map((d) => d.message)).toEqual([
    'This replaces the original file, original.pdf.',
  ]);
  expect(sha(original)).toBe(before);
  await expect(win.getByTestId('message')).toHaveCount(0);

  await answerDialogs(app, { saveAs: original, messageResponse: 0 });
  await win.getByRole('button', { name: 'Save as new file…' }).click();
  await passReview(win);
  await expect(win.getByTestId('message')).toContainText('Saved original.pdf (6 pages).');
  expect(sha(original)).not.toBe(before);
  expect((await rotations(read(original)))[0]).toBe(90);
  expect(readdirSync(dir)).toEqual(['original.pdf']);
  await closeApp(app);
});

test('unsaved changes: closing, opening another file and closing the window all ask first', async ({}, info) => {
  const run = await launch(info.project.name);
  const { app, win } = run;
  await openInPages(run, 'links.pdf');
  await tile(win, 2).click();
  await win.getByRole('button', { name: 'Rotate left' }).click();
  await expect(win.getByRole('button', { name: 'Pages', exact: true }).locator('.sf-dot')).toBeVisible();

  await goTo(win, 'Document');
  await win.getByRole('button', { name: 'Close document' }).click();
  const confirm = win.getByTestId('confirm-dialog');
  await expect(confirm).toContainText('Discard your changes?');
  await confirm.getByRole('button', { name: 'Keep editing' }).click();
  await expect(win.locator('.sf-doc-name')).toHaveText('links.pdf');

  // Closing the window: Keep editing keeps it open.
  await answerDialogs(app, { messageResponse: 1 });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await expect.poll(async () => (await dialogLog(app)).filter((d) => d.kind === 'message').length).toBe(1);
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);

  // Opening another file: Discard changes opens it.
  await openFixture(run, 'normal.pdf');
  await win.getByTestId('confirm-dialog').getByRole('button', { name: 'Discard changes' }).click();
  await waitForFirstPage(win);
  await expect(win.locator('.sf-doc-name')).toHaveText('normal.pdf');
  await goTo(win, 'Pages');
  await expect(status(win)).toHaveText('3 pages · 0 selected · No changes');
  await closeApp(app);
});

test('password-protected files: the page tools say the new file will have no password', async ({}, info) => {
  const run = await launch(info.project.name);
  const { app, win } = run;
  await openFixture(run, 'protected.pdf');
  await win.getByTestId('password-dialog').getByLabel('Password').fill('open-sesame');
  await win.getByTestId('password-dialog').getByRole('button', { name: 'Open' }).click();
  await waitForFirstPage(win);
  await goTo(win, 'Pages');
  const target = path.join(outDir(), 'unlocked.pdf');
  await answerDialogs(app, { saveAs: target });

  await win.getByRole('button', { name: 'Save as new file…' }).click();
  const confirm = win.getByTestId('confirm-dialog');
  await expect(confirm).toContainText("protected.pdf is password-protected. The new file will open without a password.");
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  expect((await dialogLog(app)).filter((d) => d.kind === 'save')).toEqual([]);

  await win.getByRole('button', { name: 'Save as new file…' }).click();
  await win.getByTestId('confirm-dialog').getByRole('button', { name: 'Save without a password' }).click();
  await passReview(win);
  await expect(win.getByTestId('message')).toContainText('Saved unlocked.pdf (2 pages).');
  expect((await pageTexts(read(target)))[0]).toContain('Protected test document');
  await closeApp(app);
});

test('keyboard: move between pages, select, move, delete, undo', async ({}, info) => {
  const run = await launch(info.project.name);
  const { app, win } = run;
  await openInPages(run, 'normal.pdf');
  await tile(win, 1).focus();
  await win.keyboard.press('ArrowRight');
  await expect(tile(win, 2)).toBeFocused();
  await win.keyboard.press('Space');
  await expect(status(win)).toContainText('1 selected');
  await win.keyboard.press('Alt+ArrowLeft');
  await expect(tile(win, 1)).toHaveAccessibleName('Page 1, was page 2');
  await win.keyboard.press('Control+a');
  await expect(status(win)).toContainText('3 selected');
  await win.keyboard.press('Delete');
  await expect(win.getByTestId('message')).toContainText('the last page can\'t be deleted');
  await tile(win, 3).click();
  await tile(win, 3).press('Delete');
  await expect(status(win)).toContainText('2 pages');
  await win.keyboard.press('Control+z');
  await expect(status(win)).toContainText('3 pages');
  await closeApp(app);
});

test('merging two 600-page files in the app takes under 10 seconds', async ({}, info) => {
  test.setTimeout(120_000);
  const run = await launch(info.project.name);
  const { app, win } = run;
  await openInPages(run, 'large.pdf');
  await answerDialogs(app, { open: [path.join(FIXTURES, 'large.pdf')] });
  await win.getByRole('button', { name: 'Add files…' }).click();
  await expect(status(win)).toContainText('1200 pages');
  const target = path.join(outDir(), 'big.pdf');
  await answerDialogs(app, { saveAs: target });
  await goTo(win, 'Settings');
  await win.getByLabel('Before saving, show what the new file carries').uncheck();
  await goTo(win, 'Pages');
  const start = Date.now();
  await win.getByRole('button', { name: 'Save as new file…' }).click();
  await expect(win.getByTestId('message')).toContainText('Saved big.pdf (1200 pages).', { timeout: 30_000 });
  const ms = Date.now() - start;
  console.log(`merge of 2 × 600 pages in the app: ${ms} ms`);
  info.annotations.push({ type: 'timing', description: `merge 2 × 600 pages: ${ms} ms` });
  expect(ms).toBeLessThan(10_000);
  expect(await strayPages(read(target))).toBe(0);
  await closeApp(app);
});

test('File > Save as new file (Ctrl+S) from the Document screen saves once', async ({}, info) => {
  const run = await launch(info.project.name);
  const { app, win } = run;
  await openInPages(run, 'normal.pdf');
  await tile(win, 2).click();
  await win.getByRole('button', { name: 'Rotate right' }).click();
  await goTo(win, 'Document');
  const target = path.join(outDir(), 'from-menu.pdf');
  await answerDialogs(app, { saveAs: target });
  // The same thing the menu item does.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('menu', 'save'));
  await passReview(win);
  await expect(win.getByTestId('message')).toContainText('Saved from-menu.pdf (3 pages).');
  expect((await dialogLog(app)).filter((d) => d.kind === 'save')).toHaveLength(1);
  // Coming back to Pages later doesn't save again.
  await goTo(win, 'Settings');
  await goTo(win, 'Pages');
  await win.waitForTimeout(500);
  expect((await dialogLog(app)).filter((d) => d.kind === 'save')).toHaveLength(1);
  await closeApp(app);
});

test('nothing is ever written next to the original unless a Save dialog chose it', async ({}, info) => {
  const run = await launch(info.project.name);
  const { app, win } = run;
  await openInPages(run, 'links.pdf');
  await tile(win, 1).click();
  await win.getByRole('button', { name: 'Rotate right' }).click();
  // Cancel the Save dialog: no file anywhere.
  await answerDialogs(app, {});
  await win.getByRole('button', { name: 'Save as new file…' }).click();
  await passReview(win);
  await expect.poll(async () => (await dialogLog(app)).filter((d) => d.kind === 'save').length).toBe(1);
  expect(existsSync(path.join(FIXTURES, 'links (edited).pdf'))).toBe(false);
  await expect(win.getByTestId('message')).toHaveCount(0);
  await closeApp(app);
});
