// Stop 1d: the Details screen and "what this file carries", driven through the real app. Saved
// files are read back with pdf.js, standing in for any other PDF reader.
import { expect, test, type Page } from '@playwright/test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { drawnText, findEverywhere, pageTexts, readerDetails } from '../unit/support/inspect';
import { answerDialogs, blockedRequests, closeApp, dialogLog, fixtureHashes, goTo, launch, openFixture, passReview, waitForFirstPage, type Running } from './helpers';

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
const row = (scope: ReturnType<Page['getByTestId']>, id: string) => scope.locator(`[data-carries="${id}"]`);
const fact = (win: Page, label: string) => win.getByTestId('details-facts').locator('dt', { hasText: label }).locator('xpath=following-sibling::dd[1]');

async function openDetails(run: Running, name: string): Promise<void> {
  await openFixture(run, name);
  await waitForFirstPage(run.win);
  await goTo(run.win, 'Details');
  await expect(run.win.getByTestId('details-screen')).toBeVisible();
}

test('the Details screen shows a file’s details and everything it carries', async ({}, info) => {
  const run = (current = await launch(info.project.name));
  const { win } = run;
  await openDetails(run, 'carries.pdf');

  await expect(win.getByLabel('Title', { exact: true })).toHaveValue('CARRIES-OLD-TITLE');
  await expect(win.getByLabel('Author', { exact: true })).toHaveValue('Fixture Author');
  await expect(win.getByLabel('Subject', { exact: true })).toHaveValue('Fixture subject');
  await expect(win.getByLabel('Keywords', { exact: true })).toHaveValue('alpha, beta');
  await expect(fact(win, 'Made with')).toHaveText('Fixture Writer 1.0');
  await expect(fact(win, 'PDF made by')).toHaveText('Fixture Maker 2.0');
  await expect(fact(win, 'PDF version')).toHaveText('1.7');
  await expect(fact(win, 'Pages')).toContainText('1 page: 8.5 × 11 in (Letter)');
  await expect(fact(win, 'Pages')).toContainText('1 page: 11.69 × 8.26 in (A4, sideways)');
  await expect(fact(win, 'Password or restrictions')).toHaveText('No');

  const carries = win.getByTestId('carries');
  await expect(row(carries, 'details')).toContainText('9 details');
  await expect(row(carries, 'details')).toContainText('Company: Fixture Company Ltd');
  await expect(row(carries, 'details')).toContainText('A second copy is kept in XMP format');
  await expect(row(carries, 'attachments')).toContainText('2 files');
  await expect(row(carries, 'attachments')).toContainText('notes.txt, 22 bytes, attached to the whole file');
  await expect(row(carries, 'attachments')).toContainText('page-file.txt, 20 bytes, on page 2');
  await expect(row(carries, 'form-fields')).toContainText('2 fields, 1 filled in');
  await expect(row(carries, 'comments')).toContainText('1 note and 1 highlight');
  await expect(row(carries, 'comments')).toContainText('By Fixture Author, Second Reviewer');
  await expect(row(carries, 'scripts')).toContainText('Script: document script "init"');
  await expect(row(carries, 'scripts')).toContainText('Opens a program or file: link on page 2');
  await expect(row(carries, 'bookmarks')).toContainText('2 bookmarks');
  await expect(row(carries, 'layers')).toContainText('2 layers, 1 hidden');
  await expect(row(carries, 'layers')).toContainText('Hidden layer (hidden)');
  await expect(row(carries, 'links')).toContainText('1 web or email link, 1 link to a page');
  await expect(row(carries, 'links')).toContainText('https://example.com/carries');
  await expect(row(carries, 'locked')).toContainText('None');
  expect(await blockedRequests(run.app)).toEqual([]);
});

test('edited details are saved in both copies, the old title is found nowhere, and hidden layers stay hidden', async ({}, info) => {
  const run = (current = await launch(info.project.name));
  const { app, win } = run;
  await openDetails(run, 'carries.pdf');

  await win.getByLabel('Title', { exact: true }).fill('New title');
  await win.getByLabel('Author', { exact: true }).fill('Pat Tester');
  await expect(win.getByRole('button', { name: 'Details', exact: true }).locator('.sf-dot')).toBeVisible();
  // Undo my changes puts the file's own values back.
  await win.getByRole('button', { name: 'Undo my changes' }).click();
  await expect(win.getByLabel('Title', { exact: true })).toHaveValue('CARRIES-OLD-TITLE');
  await expect(win.getByRole('button', { name: 'Details', exact: true }).locator('.sf-dot')).toHaveCount(0);
  await win.getByLabel('Title', { exact: true }).fill('New title');
  await win.getByLabel('Author', { exact: true }).fill('Pat Tester');

  // Save (Ctrl+S): first, what the new file carries.
  const target = path.join(outDir(), 'details.pdf');
  await answerDialogs(app, { saveAs: target });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('menu', 'save'));
  const review = win.getByTestId('review-dialog');
  await expect(review).toContainText('What the new file carries');
  await expect(review).toContainText('Scripts and other actions were removed.');
  await expect(review).toContainText("1 file attached to the whole document isn't copied into the new file.");
  await expect(row(review, 'details')).toContainText('Title: New title');
  await expect(row(review, 'details')).toContainText('Author: Pat Tester');
  await expect(row(review, 'details')).not.toContainText('Company');
  await expect(row(review, 'attachments')).toContainText('page-file.txt, 20 bytes, on page 2');
  await expect(row(review, 'form-fields')).toContainText('None');
  await expect(row(review, 'scripts')).toContainText('None');
  await expect(row(review, 'layers')).toContainText('2 layers, 1 hidden');
  expect((await dialogLog(app)).filter((d) => d.kind === 'save')).toEqual([]);
  await passReview(win);
  await expect(win.getByTestId('message')).toContainText('Saved details.pdf (2 pages).');

  const bytes = read(target);
  const { info: classic, xmp } = await readerDetails(bytes);
  expect(classic).toMatchObject({ Title: 'New title', Author: 'Pat Tester', Subject: 'Fixture subject', Keywords: 'alpha, beta' });
  expect(xmp).toMatchObject({ 'dc:title': 'New title', 'dc:creator': ['Pat Tester'], 'dc:description': 'Fixture subject' });
  expect(String(classic.Producer)).toMatch(/^ScribeForge \d+\.\d+\.\d+$/);
  expect(await findEverywhere(bytes, 'CARRIES-OLD-TITLE')).toEqual([]);
  expect(await drawnText(bytes, 1)).toContain('VISIBLE-LAYER-TEXT');
  expect(await drawnText(bytes, 1)).not.toContain('HIDDEN-LAYER-TEXT');

  // The new file opens, and its Details screen shows the saved values with nothing unsaved.
  await expect(win.locator('.sf-doc-name')).toHaveText('details.pdf');
  await goTo(win, 'Details');
  await expect(win.getByLabel('Title', { exact: true })).toHaveValue('New title');
  await expect(win.getByRole('button', { name: 'Details', exact: true }).locator('.sf-dot')).toHaveCount(0);
});

test('details that disagree, or can’t be read, are explained', async ({}, info) => {
  const run = (current = await launch(info.project.name));
  const { win } = run;
  await openDetails(run, 'stale-xmp.pdf');
  const disagree = win.getByTestId('details-disagree');
  await expect(disagree).toContainText('the two copies disagree');
  await expect(disagree).toContainText('Title: "Current title" in one copy, "STALE-XMP-TITLE" in the other (XMP).');
  await expect(win.getByLabel('Title', { exact: true })).toHaveValue('Current title');

  await openDetails(run, 'broken-xmp.pdf');
  await expect(win.getByTestId('details-unreadable')).toContainText("ScribeForge can't read");
  await expect(win.getByTestId('details-disagree')).toHaveCount(0);
});

test('a file locked against changes opens, says so, and saving says the new file has no restrictions', async ({}, info) => {
  const run = (current = await launch(info.project.name));
  const { app, win } = run;
  await openDetails(run, 'owner-locked.pdf');
  await expect(fact(win, 'Password or restrictions')).toContainText("opens without a password, but its author doesn't allow");
  await expect(fact(win, 'Password or restrictions')).toContainText('copying text and images');
  await expect(fact(win, 'Password or restrictions')).toContainText('changing the document');
  await expect(row(win.getByTestId('carries'), 'locked')).toContainText('Yes');

  const target = path.join(outDir(), 'unlocked.pdf');
  await answerDialogs(app, { saveAs: target });
  await goTo(win, 'Pages');
  await win.getByRole('button', { name: 'Save as new file…' }).click();
  const confirm = win.getByTestId('confirm-dialog');
  await expect(confirm).toContainText("The new file won't have restrictions");
  await expect(confirm).toContainText('owner-locked.pdf is locked by its author against some uses');
  await confirm.getByRole('button', { name: 'Save without restrictions' }).click();
  await expect(row(win.getByTestId('review-dialog'), 'locked')).toContainText('None');
  await passReview(win);
  await expect(win.getByTestId('message')).toContainText('Saved unlocked.pdf (1 page).');
  expect((await pageTexts(read(target)))[0]).toContain('OWNER-LOCKED-PAGE');
});

test('Cancel in the before-save list saves nothing; Settings can turn the list off', async ({}, info) => {
  const run = (current = await launch(info.project.name));
  const { app, win } = run;
  await openFixture(run, 'normal.pdf');
  await waitForFirstPage(win);
  const target = path.join(outDir(), 'quick.pdf');
  await answerDialogs(app, { saveAs: target });

  await win.getByRole('toolbar', { name: 'Annotate' }).getByRole('button', { name: 'Save as new file…' }).click();
  await win.getByTestId('review-dialog').getByRole('button', { name: 'Cancel' }).click();
  await expect(win.getByTestId('review-dialog')).toHaveCount(0);
  expect((await dialogLog(app)).filter((d) => d.kind === 'save')).toEqual([]);

  await goTo(win, 'Settings');
  await win.getByLabel('Before saving, show what the new file carries').uncheck();
  await goTo(win, 'Document');
  await win.getByRole('toolbar', { name: 'Annotate' }).getByRole('button', { name: 'Save as new file…' }).click();
  await expect(win.getByTestId('message')).toContainText('Saved quick.pdf (3 pages).');
  await expect(win.getByTestId('review-dialog')).toHaveCount(0);
});
