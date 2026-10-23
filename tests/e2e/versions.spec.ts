// Stop 3c: versions and compare, driven through the real app (docs/Plan_Phase3.md, section 5): new
// versions from a file, from the open file and when saving; the version list with notes; opening
// any version; comparing two versions page by page (a changed word, a moved block, a changed
// picture, an added page and a removed page, each on the right page); identical versions; and the
// comparison closing when the vault locks.
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { THEME_CHOICES } from '../../src/shared/themes';
import { answerDialogs, closeApp, dialogLog, FIXTURES, fixtureHashes, launch, openFixture, passReview, SCREENS, setTheme, waitForFirstPage, type Running } from './helpers';

const PASSWORD = 'a test vault password';
const TITLE = 'Tenancy agreement';
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

const screen = (win: Page) => win.getByTestId('archive-screen');
const panel = (win: Page) => screen(win).getByTestId('vault-panel');
const versions = (win: Page) => panel(win).getByTestId('vault-version');
const compare = (win: Page) => screen(win).getByTestId('compare-view');
const pages = (win: Page) => compare(win).getByTestId('compare-page');

async function goToArchive(win: Page) {
  await win.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Archive', exact: true }).click();
}

/** Makes a vault holding version-1.pdf, selected, with these files added as its next versions. */
async function vaultWithVersions(app: ElectronApplication, win: Page, next: string[]) {
  await goToArchive(win);
  await screen(win).getByLabel(/^Password \(at least 10 characters\)/).fill(PASSWORD);
  await screen(win).getByLabel('The password again').fill(PASSWORD);
  await screen(win).getByLabel('Also make a recovery code, in case I forget the password').uncheck();
  await screen(win).getByRole('button', { name: 'Make the vault' }).click();
  await answerDialogs(app, { open: [path.join(FIXTURES, 'version-1.pdf')] });
  await screen(win).getByRole('button', { name: 'Add PDFs…' }).click();
  await expect(win.getByTestId('message')).toContainText(`Added “${TITLE}” to the Archive.`);
  await screen(win).getByRole('list', { name: 'Documents' }).getByRole('button', { name: new RegExp(TITLE) }).click();
  for (const [i, name] of next.entries()) {
    await answerDialogs(app, { open: [path.join(FIXTURES, name)] });
    await panel(win).getByRole('button', { name: 'Add a new version…' }).click();
    await expect(win.getByTestId('message')).toContainText(`Added version ${i + 2} of “${TITLE}”.`);
  }
  await expect(versions(win)).toHaveCount(next.length + 1);
}

async function compareVersions(win: Page, first: number, second: number) {
  await panel(win).getByRole('combobox', { name: 'Compare version' }).selectOption(String(first));
  await panel(win).getByRole('combobox', { name: 'with version' }).selectOption(String(second));
  await panel(win).getByRole('button', { name: 'Compare', exact: true }).click();
  await expect(compare(win).getByTestId('compare-summary')).toBeVisible({ timeout: 60_000 });
}

test('new versions from a file and from the open file, listed newest first with notes; any version opens', async ({}, info) => {
  const run = (current = await launch(info.project.name));
  const { app, win } = run;
  await vaultWithVersions(app, win, ['version-2.pdf']);
  expect((await dialogLog(app)).filter((d) => d.kind === 'open').at(-1)?.title).toBe('Choose the new version');
  await expect(versions(win).first()).toContainText('Version 2');
  await expect(versions(win).first()).toContainText('Newest');
  await expect(versions(win).first()).toContainText('version-2.pdf');
  await expect(versions(win).nth(1)).toContainText('Version 1');
  await expect(panel(win)).toContainText('2 (the newest is the one opened and searched)');

  // A note on a version: kept, and the history says it changed without saying what it says.
  await panel(win).getByLabel('Note on version 2').fill('After the meeting');
  await panel(win).getByLabel('Title').click();
  await screen(win).getByRole('radio', { name: 'History' }).click();
  await expect(screen(win).getByTestId('vault-history')).toContainText(`Version 2 of “${TITLE}” was added.`);
  await expect(screen(win).getByTestId('vault-history')).toContainText(`The note on version 2 of “${TITLE}” was changed.`);
  await expect(screen(win).getByTestId('vault-history')).not.toContainText('After the meeting');
  await screen(win).getByRole('radio', { name: 'Documents' }).click();
  await screen(win).getByRole('list', { name: 'Documents' }).getByRole('button', { name: new RegExp(TITLE) }).click();
  await expect(panel(win).getByLabel('Note on version 2')).toHaveValue('After the meeting');

  // Any version opens; its name says which.
  await panel(win).getByRole('button', { name: 'Open version 1' }).click();
  await waitForFirstPage(win);
  await expect(win.locator('.sf-doc-name')).toHaveText('version-1 (version 1).pdf');
  await goToArchive(win);
  await screen(win).getByRole('list', { name: 'Documents' }).getByRole('button', { name: new RegExp(TITLE) }).click();
  await panel(win).getByRole('button', { name: 'Open', exact: true }).click();
  await waitForFirstPage(win);
  await expect(win.locator('.sf-doc-name')).toHaveText('version-2.pdf');

  // The open file (from a folder) as a new version.
  await openFixture(run, 'normal.pdf');
  await waitForFirstPage(win);
  await goToArchive(win);
  await screen(win).getByRole('list', { name: 'Documents' }).getByRole('button', { name: new RegExp(TITLE) }).click();
  await panel(win).getByRole('button', { name: 'Add the open file as a new version' }).click();
  await expect(win.getByTestId('message')).toContainText(`Added version 3 of “${TITLE}”.`);
  await expect(versions(win)).toHaveCount(3);
  await expect(versions(win).first()).toContainText('normal.pdf');
  // The document keeps its title; the newest version is the one searched.
  await screen(win).getByLabel('Search the Archive').fill('anvil');
  await screen(win).getByRole('button', { name: 'Search', exact: true }).click();
  await expect(screen(win).getByTestId('search-result')).toContainText(`${TITLE} · 3 pages match`);
});

test('compare finds each kind of change on the right page; identical versions say so; locking closes the comparison', async ({}, info) => {
  test.setTimeout(120_000);
  const run = (current = await launch(info.project.name));
  const { app, win } = run;
  await vaultWithVersions(app, win, ['version-2.pdf', 'version-1.pdf']);

  await compareVersions(win, 1, 2);
  await expect(compare(win).getByTestId('compare-summary')).toHaveText('3 pages changed, 1 page added, 1 page removed and 1 page the same.');
  await expect(pages(win)).toHaveCount(5);
  const [added, fee, blocks, picture, removed] = [0, 1, 2, 3, 4].map((i) => pages(win).nth(i));

  await expect(added.getByRole('heading')).toHaveText('Page 2: added in version 2');
  await expect(added).toContainText('Not in version 1');
  await expect(added).toContainText('Version 2, page 2');

  await expect(fee.getByRole('heading')).toHaveText('Page 2, now page 3: changed');
  await expect(fee).toContainText('Words removed: “100”');
  await expect(fee).toContainText('Words added: “120”');
  await expect(fee.getByTestId('compare-box')).toHaveCount(2); // the same place, on each side

  await expect(blocks.getByRole('heading')).toHaveText('Page 3, now page 4: changed');
  await expect(blocks).toContainText(/Moved on the page: “Block (Alpha|Beta) says/);
  await expect(blocks.getByTestId('compare-box')).toHaveCount(4); // both blocks, on each side

  await expect(picture.getByRole('heading')).toHaveText('Page 4, now page 5: changed');
  await expect(picture).toContainText('No words changed. Something drawn on the page changed');
  await expect(picture.getByTestId('compare-box')).toHaveCount(2);

  await expect(removed.getByRole('heading')).toHaveText('Page 5: removed in version 2');
  await expect(removed).toContainText('Not in version 2');
  await expect(removed).toContainText('Version 1, page 5');

  await compare(win).getByLabel('Show the pages that are the same').check();
  await expect(pages(win)).toHaveCount(6);
  await expect(pages(win).first().getByRole('heading')).toHaveText('Page 1: the same');
  await expect(pages(win).first().getByTestId('compare-box')).toHaveCount(0);

  // Version 3 is version 1 again: identical.
  await compare(win).getByRole('button', { name: 'Back to the Archive' }).click();
  await compareVersions(win, 1, 3);
  await expect(compare(win).getByTestId('compare-summary')).toHaveText('The two versions are identical: all 5 pages are the same.');
  await expect(pages(win)).toHaveCount(0);

  // Locking closes the comparison, and everything decrypted with it.
  await app.evaluate(({ powerMonitor }) => powerMonitor.emit('lock-screen'));
  await expect(compare(win)).toHaveCount(0);
  await expect(screen(win).getByTestId('vault-locked-note')).toBeVisible();
});

test('saving a file opened from the Archive can add it as a new version', async ({}, info) => {
  const run = (current = await launch(info.project.name));
  const { app, win } = run;
  await vaultWithVersions(app, win, []);
  await panel(win).getByRole('button', { name: 'Open', exact: true }).click();
  await waitForFirstPage(win);
  const target = path.join(mkdtempSync(path.join(tmpdir(), 'scribeforge-e2e-out-')), 'tenancy signed.pdf');
  await answerDialogs(app, { saveAs: target });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('menu', 'save'));
  const choices = win.getByTestId('review-dialog').getByTestId('review-archive');
  await expect(choices.getByLabel("Don't keep it in the Archive")).toBeChecked();
  await choices.getByLabel(`Save as a new version of “${TITLE}”`).check();
  await passReview(win);
  await expect(win.getByTestId('message')).toContainText(`It's also in the Archive, as version 2 of “${TITLE}”.`);
  await goToArchive(win);
  await expect(screen(win).getByRole('list', { name: 'Documents' }).getByRole('listitem')).toHaveCount(1);
  await screen(win).getByRole('list', { name: 'Documents' }).getByRole('button', { name: new RegExp(TITLE) }).click();
  await expect(versions(win)).toHaveCount(2);
  await expect(versions(win).first()).toContainText('tenancy signed.pdf');
});

test('screenshots of versions and compare in every theme', async ({}, info) => {
  test.setTimeout(300_000);
  mkdirSync(SCREENS, { recursive: true });
  const run = (current = await launch(info.project.name));
  const { app, win } = run;
  await win.setViewportSize({ width: 1280, height: 800 });
  await vaultWithVersions(app, win, ['version-2.pdf']);
  await panel(win).getByLabel('Note on version 2').fill('After the meeting with the landlord');
  await panel(win).getByLabel('Title').click();
  const rows: string[][] = [];
  for (const theme of THEME_CHOICES) {
    await setTheme(win, theme.id);
    const row: string[] = [];
    const shot = async (name: string) => {
      await win.waitForTimeout(400);
      const file = path.join(SCREENS, `${theme.id}-versions-${name}.png`);
      await win.screenshot({ path: file });
      row.push(file);
    };
    await goToArchive(win);
    await screen(win).getByRole('list', { name: 'Documents' }).getByRole('button', { name: new RegExp(TITLE) }).click();
    await panel(win).getByTestId('vault-versions').scrollIntoViewIfNeeded();
    await shot('list');
    await compareVersions(win, 1, 2);
    await pages(win).nth(1).scrollIntoViewIfNeeded();
    await expect(pages(win).nth(1).getByTestId('compare-box')).toHaveCount(2);
    await shot('compare');
    await compare(win).getByRole('button', { name: 'Back to the Archive' }).click();
    rows.push(row);
  }
  const scale = 0.3;
  const w = Math.round(1280 * scale);
  const h = Math.round(800 * scale);
  const columns = 2;
  const sheet = createCanvas(w * columns + 10 * (columns + 1), (h + 10) * rows.length + 10);
  const g = sheet.getContext('2d');
  g.fillStyle = '#808080';
  g.fillRect(0, 0, sheet.width, sheet.height);
  for (const [r, row] of rows.entries()) for (const [c, file] of row.entries()) g.drawImage(await loadImage(file), 10 + c * (w + 10), 10 + r * (h + 10), w, h);
  writeFileSync(path.join(SCREENS, 'contact-sheet-versions.png'), sheet.toBuffer('image/png'));
});
