import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  blockedRequests,
  fixtureHashes,
  goTo,
  launch,
  openedLinks,
  openFixture,
  recordOpenedLinks,
  waitForFirstPage,
} from './helpers';

let hashesBefore: Record<string, string>;
test.beforeAll(() => {
  hashesBefore = fixtureHashes();
});
test.afterAll(() => {
  // ScribeForge never changes the files it opens.
  expect(fixtureHashes()).toEqual(hashesBefore);
});

test('opens a PDF with page count, pages and thumbnails', async ({}, info) => {
  const run = await launch(info.project.name);
  const { app, win } = run;
  await openFixture(run, 'normal.pdf');
  await waitForFirstPage(win);
  await expect(win.getByTestId('page-count')).toHaveText('of 3');
  await expect(win.locator('.sf-doc-name')).toHaveText('normal.pdf');
  await expect(win.locator('.sf-thumb-canvas[data-rendered="true"]')).toHaveCount(3);
  await expect(win.getByRole('button', { name: 'Page 1' })).toHaveAttribute('aria-current', 'page');

  // Leaving the document and coming back keeps it as it was.
  await goTo(win, 'Settings');
  await goTo(win, 'Document');
  await expect(win.locator('.page[data-page-number="1"] canvas').first()).toBeVisible();
  expect(await blockedRequests(app)).toEqual([]);
  await app.close();
});

test('comment icons in documents show (not as broken images)', async ({}, info) => {
  const run = await launch(info.project.name);
  const { app, win } = run;
  await openFixture(run, 'links.pdf');
  await waitForFirstPage(win);
  const icon = win.locator('.page[data-page-number="1"] .annotationLayer img').first();
  await icon.waitFor({ state: 'attached' });
  await expect.poll(() => icon.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  expect(await blockedRequests(app)).toEqual([]);
  await app.close();
});

test('opening another file replaces the first one completely', async ({}, info) => {
  const run = await launch(info.project.name);
  const { app, win } = run;
  await openFixture(run, 'large.pdf');
  await waitForFirstPage(win);
  await expect(win.getByTestId('page-count')).toHaveText('of 600');
  await openFixture(run, 'normal.pdf');
  await waitForFirstPage(win);
  await expect(win.getByTestId('page-count')).toHaveText('of 3');
  // Only the new document's pages and thumbnails are left.
  await expect(win.locator('.pdfViewer .page')).toHaveCount(3);
  await expect(win.locator('.sf-thumb')).toHaveCount(3);
  await expect(win.locator('.sf-doc-name')).toHaveText('normal.pdf');
  await app.close();
});

test('page navigation, thumbnails and zoom', async ({}, info) => {
  const run = await launch(info.project.name);
  const { app, win } = run;
  await openFixture(run, 'normal.pdf');
  await waitForFirstPage(win);
  const pageBox = win.getByLabel('Page number');

  await win.getByRole('button', { name: 'Next page' }).click();
  await expect(pageBox).toHaveValue('2');
  await pageBox.fill('3');
  await pageBox.press('Enter');
  await expect(pageBox).toHaveValue('3');
  await expect(win.getByRole('button', { name: 'Next page' })).toBeDisabled();
  await win.getByRole('button', { name: 'Page 1' }).click();
  await expect(pageBox).toHaveValue('1');

  const zoom = win.getByLabel('Zoom', { exact: true });
  await zoom.selectOption('2');
  await expect(zoom).toHaveValue('2');
  const width200 = await win.locator('.page[data-page-number="1"]').evaluate((e) => e.getBoundingClientRect().width);
  await zoom.selectOption('1');
  const width100 = await win.locator('.page[data-page-number="1"]').evaluate((e) => e.getBoundingClientRect().width);
  expect(width200 / width100).toBeGreaterThan(1.9);
  await win.getByRole('button', { name: 'Zoom in' }).click();
  await expect.poll(async () => win.locator('.page[data-page-number="1"]').evaluate((e) => e.getBoundingClientRect().width)).toBeGreaterThan(width100);
  await zoom.selectOption('page-fit');
  await expect(zoom).toHaveValue('page-fit');

  await win.getByRole('button', { name: 'Thumbnails' }).click();
  await expect(win.locator('.sf-thumbs')).toHaveCount(0);
  await win.getByRole('button', { name: 'Thumbnails' }).click();
  await expect(win.locator('.sf-thumbs')).toHaveCount(1);
  await app.close();
});

test('find in document counts and steps through matches', async ({}, info) => {
  const run = await launch(info.project.name);
  const { app, win } = run;
  await openFixture(run, 'normal.pdf');
  await waitForFirstPage(win);
  const search = win.getByLabel('Find in document');
  await search.fill('anvil');
  await expect(win.getByTestId('find-count')).toHaveText('1 of 5');
  await search.press('Enter');
  await expect(win.getByTestId('find-count')).toHaveText('2 of 5');
  await win.getByRole('button', { name: 'Previous match' }).click();
  await expect(win.getByTestId('find-count')).toHaveText('1 of 5');
  await search.fill('dragon');
  await expect(win.getByTestId('find-count')).toHaveText('Not found');
  await app.close();
});

test('text can be selected and copied', async ({}, info) => {
  const run = await launch(info.project.name);
  const { app, win } = run;
  await openFixture(run, 'normal.pdf');
  await waitForFirstPage(win);
  const line = win.locator('.textLayer span', { hasText: 'quill and anvil' }).first();
  await line.waitFor();
  await line.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
  });
  // The same command the Edit > Copy menu item runs.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.copy());
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toContain('quill and anvil 0O1lI');
  await app.close();
});

test('web links ask first and show the address; links to pages just go there', async ({}, info) => {
  const run = await launch(info.project.name);
  const { app, win } = run;
  await recordOpenedLinks(app);
  await openFixture(run, 'normal.pdf');
  await waitForFirstPage(win);
  const page1 = win.locator('.page[data-page-number="1"] .annotationLayer');
  await page1.locator('a').first().waitFor({ state: 'attached' });

  // Internal link: "Go to page 3".
  await page1.locator('section.linkAnnotation').nth(0).locator('a').click();
  await expect(win.getByLabel('Page number')).toHaveValue('3');

  // Web link: asks, Cancel does nothing.
  await win.getByRole('button', { name: 'Page 1' }).click();
  await page1.locator('section.linkAnnotation').nth(1).locator('a').click();
  const dialog = win.getByTestId('link-dialog');
  await expect(dialog).toBeVisible();
  await expect(win.getByTestId('link-address')).toHaveText('https://example.com/scribeforge-test');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  expect(await openedLinks(app)).toEqual([]);

  // Open in browser hands it to Windows; the app itself still makes no request.
  await page1.locator('section.linkAnnotation').nth(1).locator('a').click();
  await win.getByRole('button', { name: 'Open in browser' }).click();
  await expect.poll(() => openedLinks(app)).toEqual(['https://example.com/scribeforge-test']);
  expect(await blockedRequests(app)).toEqual([]);
  await app.close();
});

test('password-protected files ask for the password and never store it', async ({}, info) => {
  const run = await launch(info.project.name);
  const { app, win } = run;
  await openFixture(run, 'protected.pdf');
  const dialog = win.getByTestId('password-dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Password').fill('wrong-password');
  await dialog.getByRole('button', { name: 'Open' }).click();
  await expect(win.getByTestId('password-dialog').getByRole('alert')).toHaveText("That password didn't work. Try again.");
  await expect(win.getByTestId('password-dialog').getByLabel('Password')).toHaveValue('');
  await win.getByTestId('password-dialog').getByLabel('Password').fill('open-sesame');
  await win.getByTestId('password-dialog').getByRole('button', { name: 'Open' }).click();
  await waitForFirstPage(win);
  await expect(win.getByTestId('page-count')).toHaveText('of 2');
  const settingsText = readFileSync(path.join(run.userData, 'settings.json'), 'utf8');
  expect(settingsText).not.toContain('open-sesame');
  expect(settingsText).not.toContain('wrong-password');

  // Cancelling leaves the app as it was.
  await openFixture(run, 'protected.pdf');
  await win.getByTestId('password-dialog').getByRole('button', { name: 'Cancel' }).click();
  await expect(win.getByTestId('password-dialog')).toHaveCount(0);
  await expect(win.getByTestId('message')).toHaveCount(0);
  await app.close();
});

test('damaged files and non-PDFs show a plain message, and the app keeps working', async ({}, info) => {
  const run = await launch(info.project.name);
  const { app, win } = run;
  for (const name of ['not-a-pdf.pdf', 'damaged-truncated.pdf', 'damaged-xref.pdf']) {
    await openFixture(run, name);
    // Either a message, or pdf.js recovered what it could and shows the document.
    await expect
      .poll(async () => (await win.getByTestId('message').count()) + (await win.locator('[data-testid="viewer"][data-ready="true"]').count()))
      .toBeGreaterThan(0);
    if (await win.getByTestId('message').count()) {
      await expect(win.getByTestId('message')).toContainText(name);
      await win.getByRole('button', { name: 'Dismiss message' }).click();
    }
  }
  await openFixture(run, 'not-a-pdf.pdf');
  await expect(win.getByTestId('message')).toContainText("couldn't open not-a-pdf.pdf");
  await openFixture(run, 'normal.pdf');
  await waitForFirstPage(win);
  await expect(win.getByTestId('page-count')).toHaveText('of 3');
  expect(await blockedRequests(app)).toEqual([]);
  await app.close();
});

test('PDF JavaScript never runs: no dialogs, no requests, no links opened', async ({}, info) => {
  const run = await launch(info.project.name);
  const { app, win } = run;
  await recordOpenedLinks(app);
  const dialogs: string[] = [];
  win.on('dialog', (d) => {
    dialogs.push(d.message());
    void d.dismiss();
  });
  await openFixture(run, 'scripted.pdf');
  await waitForFirstPage(win);
  const scriptLink = win.locator('.page[data-page-number="1"] .annotationLayer section.linkAnnotation a').first();
  if (await scriptLink.count()) await scriptLink.click();
  await win.waitForTimeout(2000);
  expect(dialogs).toEqual([]);
  expect(await blockedRequests(app)).toEqual([]);
  expect(await openedLinks(app)).toEqual([]);
  await expect(win.getByTestId('link-dialog')).toHaveCount(0);
  await app.close();
});

test('a 600-page file shows its first page within 2 seconds', async ({}, info) => {
  const run = await launch(info.project.name);
  const { app, win } = run;
  const times: number[] = [];
  for (let i = 0; i < 3; i++) {
    const start = Date.now();
    await openFixture(run, 'large.pdf');
    await waitForFirstPage(win);
    times.push(Date.now() - start);
    await expect(win.getByTestId('page-count')).toHaveText('of 600');
    await win.getByRole('button', { name: 'Close document' }).click();
  }
  info.annotations.push({ type: 'timing', description: `large.pdf first page: ${times.join(' ms, ')} ms` });
  console.log(`large.pdf first page: ${times.join(' ms, ')} ms`);
  expect(Math.max(...times)).toBeLessThan(2000);
  await app.close();
});
