// The installed app (the unpacked installer build in release/win-unpacked): the same safety
// checks as the development build, on the files that actually ship.
import { expect, test } from '@playwright/test';
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { annotations, drawnText, findEverywhere, pageIds, readerDetails, strayPages } from '../unit/support/inspect';
import {
  answerDialogs,
  blockedRequests,
  closeApp,
  fixtureHashes,
  goTo,
  launch,
  openedLinks,
  openFixture,
  PACKAGED_EXE,
  passReview,
  recordOpenedLinks,
  setTheme,
  VERSION,
  waitForFirstPage,
} from './helpers';

test('the installed app opens PDFs, keeps PDF JavaScript off and makes no network requests', async ({}, info) => {
  test.skip(!existsSync(PACKAGED_EXE), 'Run "npm run pack" first.');
  const before = fixtureHashes();
  const run = await launch(info.project.name);
  const { app, win } = run;
  await recordOpenedLinks(app);
  const dialogs: string[] = [];
  win.on('dialog', (d) => {
    dialogs.push(d.message());
    void d.dismiss();
  });

  await goTo(win, 'About');
  await expect(win.getByTestId('about-version')).toHaveText(`Version ${VERSION}`);

  await openFixture(run, 'large.pdf');
  await waitForFirstPage(win);
  await expect(win.getByTestId('page-count')).toHaveText('of 600');

  await openFixture(run, 'normal.pdf');
  await waitForFirstPage(win);
  await win.getByLabel('Find in document').fill('anvil');
  await expect(win.getByTestId('find-count')).toHaveText('1 of 5');

  await openFixture(run, 'protected.pdf');
  await win.getByTestId('password-dialog').getByLabel('Password').fill('open-sesame');
  await win.getByTestId('password-dialog').getByRole('button', { name: 'Open' }).click();
  await waitForFirstPage(win);
  await expect(win.getByTestId('page-count')).toHaveText('of 2');

  await openFixture(run, 'scripted.pdf');
  await waitForFirstPage(win);
  await win.waitForTimeout(1500);

  for (const theme of ['light', 'high-contrast', 'cathedral']) await setTheme(win, theme);

  expect(dialogs).toEqual([]);
  expect(await openedLinks(app)).toEqual([]);
  expect(await blockedRequests(app)).toEqual([]);
  await app.close();
  expect(fixtureHashes()).toEqual(before);
});

test('the installed app\'s page tools build, save and split files', async ({}, info) => {
  test.skip(!existsSync(PACKAGED_EXE), 'Run "npm run pack" first.');
  const before = fixtureHashes();
  const run = await launch(info.project.name);
  const { app, win } = run;
  await openFixture(run, 'links.pdf');
  await waitForFirstPage(win);
  await goTo(win, 'Pages');
  await win.getByRole('option', { name: /^Page 1(,|$)/ }).click();
  await win.getByRole('button', { name: 'Rotate right' }).click();
  await win.getByRole('option', { name: /^Page 6(,|$)/ }).click();
  await win.getByRole('button', { name: 'Delete' }).click();
  const out = mkdtempSync(path.join(tmpdir(), 'scribeforge-e2e-out-'));
  await answerDialogs(app, { saveAs: path.join(out, 'edited.pdf') });
  await win.getByRole('button', { name: 'Save as new file…' }).click();
  await passReview(win);
  await expect(win.getByTestId('message')).toContainText('Saved edited.pdf (5 pages).');
  const bytes = new Uint8Array(readFileSync(path.join(out, 'edited.pdf')));
  expect(await pageIds(bytes)).toEqual([1, 2, 3, 4, 5].map((n) => `UNIQUE-PAGE-${n}`));
  expect(await findEverywhere(bytes, 'UNIQUE-PAGE-6')).toEqual([]);
  expect(await strayPages(bytes)).toBe(0);

  await goTo(win, 'Pages');
  await win.getByRole('button', { name: 'Split…' }).click();
  await answerDialogs(app, { folder: out });
  await win.getByTestId('split-dialog').getByRole('button', { name: 'Choose a folder and split' }).click();
  await passReview(win);
  await expect(win.getByTestId('message')).toContainText('Split into 3 files');
  expect(await blockedRequests(app)).toEqual([]);
  await closeApp(app);
  expect(fixtureHashes()).toEqual(before);
});

test("the installed app's Details screen reads a file, and edited details are saved in both copies", async ({}, info) => {
  test.skip(!existsSync(PACKAGED_EXE), 'Run "npm run pack" first.');
  const before = fixtureHashes();
  const run = await launch(info.project.name);
  const { app, win } = run;
  await openFixture(run, 'carries.pdf');
  await waitForFirstPage(win);
  await goTo(win, 'Details');
  await expect(win.getByTestId('carries').locator('[data-carries="layers"]')).toContainText('2 layers, 1 hidden');
  await win.getByLabel('Title', { exact: true }).fill('Installed title');
  const out = mkdtempSync(path.join(tmpdir(), 'scribeforge-e2e-out-'));
  await answerDialogs(app, { saveAs: path.join(out, 'details.pdf') });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('menu', 'save'));
  await expect(win.getByTestId('review-dialog')).toContainText('Title: Installed title');
  await passReview(win);
  await expect(win.getByTestId('message')).toContainText('Saved details.pdf (2 pages).');
  const bytes = new Uint8Array(readFileSync(path.join(out, 'details.pdf')));
  const { info: classic, xmp } = await readerDetails(bytes);
  expect(classic.Title).toBe('Installed title');
  expect(xmp?.['dc:title']).toBe('Installed title');
  expect(await findEverywhere(bytes, 'CARRIES-OLD-TITLE')).toEqual([]);
  expect(await drawnText(bytes, 1)).not.toContain('HIDDEN-LAYER-TEXT');
  expect(await blockedRequests(app)).toEqual([]);
  await closeApp(app);
  expect(fixtureHashes()).toEqual(before);
});

test("the installed app's annotations are saved for other readers", async ({}, info) => {
  test.skip(!existsSync(PACKAGED_EXE), 'Run "npm run pack" first.');
  const before = fixtureHashes();
  const run = await launch(info.project.name);
  const { app, win } = run;
  await goTo(win, 'Settings');
  await win.getByLabel('Your name on annotations').fill('Pat Tester');
  await win.getByLabel('Your name on annotations').press('Enter');
  await openFixture(run, 'normal.pdf');
  await waitForFirstPage(win);
  const annotate = win.getByRole('toolbar', { name: 'Annotate' });

  await annotate.getByRole('button', { name: 'Highlight', exact: true }).click();
  const anvil = win.locator('.page[data-page-number="1"] .textLayer span', { hasText: 'anvil' }).first();
  const box = (await anvil.boundingBox())!;
  await win.mouse.move(box.x + 1, box.y + box.height / 2);
  await win.mouse.down();
  await win.mouse.move(box.x + box.width - 1, box.y + box.height / 2, { steps: 6 });
  await win.mouse.up();
  await expect(win.locator('.sf-annot-highlight')).toHaveCount(1);

  await annotate.getByRole('button', { name: 'Text box', exact: true }).click();
  const page = (await win.locator('.page[data-page-number="1"]').boundingBox())!;
  await win.mouse.click(page.x + page.width * 0.2, page.y + page.height * 0.3);
  await win.getByTestId('annot-panel').getByRole('textbox').fill('Checked');
  await win.getByTestId('annot-panel').getByRole('button', { name: 'Done' }).click();

  const out = mkdtempSync(path.join(tmpdir(), 'scribeforge-e2e-out-'));
  await answerDialogs(app, { saveAs: path.join(out, 'annotated.pdf') });
  await annotate.getByRole('button', { name: 'Save as new file…' }).click();
  await passReview(win);
  await expect(win.getByTestId('message')).toContainText('2 annotations saved with the pages.');
  const saved = await annotations(new Uint8Array(readFileSync(path.join(out, 'annotated.pdf'))));
  expect(saved.map((a) => [a.page, a.subtype, a.author])).toEqual([
    [1, 'Highlight', 'Pat Tester'],
    [1, 'FreeText', 'Pat Tester'],
  ]);
  expect(await blockedRequests(app)).toEqual([]);
  await closeApp(app);
  expect(fixtureHashes()).toEqual(before);
});

test('the installed app ships no pdf.js scripting sandbox and no node_modules', async () => {
  test.skip(!existsSync(PACKAGED_EXE), 'Run "npm run pack" first.');
  const resources = path.join(path.dirname(PACKAGED_EXE), 'resources');
  expect(existsSync(path.join(resources, 'app.asar'))).toBe(true);
  expect(existsSync(path.join(resources, 'app.asar.unpacked'))).toBe(false);
  // @electron/asar comes with electron-builder; it reads the app bundle's file list.
  const { listPackage } = await import('@electron/asar');
  const files = listPackage(path.join(resources, 'app.asar'), { isPack: false }).map((f) => f.replace(/\\/g, '/'));
  expect(files.length).toBeGreaterThan(50);
  expect(files.filter((f) => /sandbox|node_modules|\/src\/|\/tests\//i.test(f))).toEqual([]);
  expect(files).toContain('/out/renderer/pdfjs/standard_fonts/FoxitFixed.pfb');
  expect(readdirSync(resources)).toEqual(expect.arrayContaining(['LICENSE', 'THIRD-PARTY-NOTICES.md']));
  // Electron's own Chromium notices ship next to the app.
  expect(existsSync(path.join(path.dirname(PACKAGED_EXE), 'LICENSES.chromium.html'))).toBe(true);
});
