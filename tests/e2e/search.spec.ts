// Stop 3b: searching the Archive, driven through the real app (docs/Plan_Phase3.md, section 5):
// words, phrases and word starts, results by page with the matching words picked out, opening at
// the page found, filters, voided documents, pages without text, rebuilding the index, and how
// long a long PDF takes to be ready for search.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import path from 'node:path';
import { answerDialogs, closeApp, FIXTURES, fixtureHashes, launch, waitForFirstPage, type Running } from './helpers';

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

const screen = (win: Page) => win.getByTestId('archive-screen');
const results = (win: Page) => screen(win).getByTestId('search-results');

async function vaultWith(app: ElectronApplication, win: Page, names: string[]) {
  await win.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Archive', exact: true }).click();
  await screen(win).getByLabel(/^Password \(at least 10 characters\)/).fill(PASSWORD);
  await screen(win).getByLabel('The password again').fill(PASSWORD);
  await screen(win).getByLabel('Also make a recovery code, in case I forget the password').uncheck();
  await screen(win).getByRole('button', { name: 'Make the vault' }).click();
  await answerDialogs(app, { open: names.map((n) => path.join(FIXTURES, n)) });
  await screen(win).getByRole('button', { name: 'Add PDFs…' }).click();
  await expect(win.getByTestId('message')).toContainText('to the Archive', { timeout: 60_000 });
}

async function search(win: Page, text: string) {
  await screen(win).getByLabel('Search the Archive').fill(text);
  await screen(win).getByRole('button', { name: 'Search', exact: true }).click();
}

test('words, phrases and word starts find the right pages, with the matching words picked out; a result opens at its page', async ({}, info) => {
  const run = (current = await launch(info.project.name));
  const { app, win } = run;
  await vaultWith(app, win, ['normal.pdf', 'links.pdf', 'carries.pdf']);

  await search(win, 'anvil');
  await expect(results(win).getByTestId('search-summary')).toHaveText('Found in 1 document.');
  const result = results(win).getByTestId('search-result');
  await expect(result).toContainText('ScribeForge test document · 3 pages match');
  await expect(result.locator('mark.sf-match').first()).toHaveText('anvil');

  await search(win, '"third anvil"');
  await expect(result).toContainText('1 page matches');
  await expect(result.getByRole('button', { name: /at page 3$/ })).toBeVisible();
  await expect(result.locator('mark.sf-match')).toHaveText('third anvil');

  await search(win, 'anv*');
  await expect(result).toContainText('3 pages match');
  await search(win, 'anv');
  await expect(results(win).getByTestId('search-summary')).toHaveText('Nothing found for anv.');

  // The page found opens.
  await search(win, '"third anvil"');
  await result.getByRole('button', { name: /at page 3$/ }).click();
  await waitForFirstPage(win);
  await expect(win.getByLabel('Page number')).toHaveValue('3');
  await expect(win.locator('.sf-doc-name')).toHaveText('normal.pdf');
});

test('voided documents are left out unless asked for; labels filter; pages without text are listed; rebuilding gives the same results', async ({}, info) => {
  const run = (current = await launch(info.project.name));
  const { app, win } = run;
  await vaultWith(app, win, ['normal.pdf', 'no-text.pdf']);
  const textless = screen(win).getByTestId('vault-textless');
  await expect(textless).toContainText('Scanned and typed: page 2');

  await search(win, 'quillword');
  await expect(results(win).getByTestId('search-result')).toContainText('Scanned and typed · 1 page matches');

  // Label filter.
  const items = screen(win).getByRole('list', { name: 'Documents' });
  await screen(win).getByLabel('Search the Archive').fill('');
  await items.getByRole('button', { name: /Scanned and typed/ }).click();
  await screen(win).getByTestId('vault-panel').getByLabel('Labels, separated with commas').fill('Scans');
  await screen(win).getByTestId('vault-panel').getByLabel('Title').click();
  await search(win, 'quillword');
  await screen(win).getByRole('combobox', { name: /^Label/ }).selectOption('Scans');
  await expect(results(win).getByTestId('search-result')).toHaveCount(1);
  await search(win, 'anvil');
  await expect(results(win).getByTestId('search-summary')).toHaveText('Nothing found for anvil.');
  await screen(win).getByRole('combobox', { name: /^Label/ }).selectOption('');

  // Voided: left out, unless asked for.
  await screen(win).getByLabel('Search the Archive').fill('');
  await items.getByRole('button', { name: /ScribeForge test document/ }).click();
  await screen(win).getByTestId('vault-panel').getByRole('button', { name: 'Void…' }).click();
  await win.getByTestId('void-dialog').getByLabel('Reason').fill('Old');
  await win.getByTestId('void-dialog').getByRole('button', { name: 'Void it' }).click();
  await search(win, 'anvil');
  await expect(results(win).getByTestId('search-summary')).toHaveText('Nothing found for anvil.');
  await screen(win).getByLabel('Show voided documents').check();
  await expect(results(win).getByTestId('search-result')).toContainText('· Voided');

  // Rebuild: every document is read again, and the same searches give the same results.
  await screen(win).getByRole('button', { name: 'Rebuild the search index…' }).click();
  await win.getByTestId('confirm-dialog').getByRole('button', { name: 'Rebuild it' }).click();
  await expect(screen(win).getByTestId('vault-indexing')).toHaveCount(0, { timeout: 30_000 });
  await search(win, 'anvil');
  await expect(results(win).getByTestId('search-result')).toContainText('3 pages match');
  await search(win, 'quillword');
  await expect(results(win).getByTestId('search-result')).toContainText('Scanned and typed');
  await expect(textless).toContainText('Scanned and typed: page 2');
});

test('a 600-page PDF is ready for search well within the time allowed (10 seconds per 100 pages)', async ({}, info) => {
  test.setTimeout(180_000);
  const run = (current = await launch(info.project.name));
  const { app, win } = run;
  const started = Date.now();
  await vaultWith(app, win, ['large.pdf']);
  const took = (Date.now() - started) / 1000;
  console.log(`[${info.project.name}] 600 pages ready for search in ${took.toFixed(1)} s`);
  expect(took).toBeLessThan(60);
  await search(win, '"page 517 of 600"');
  await expect(results(win).getByTestId('search-result')).toContainText('1 page matches');
  await expect(results(win).getByTestId('search-result').getByRole('button', { name: /at page 517$/ })).toBeVisible();
});
