// Stop 2d: the Clean up screen, and what a redacted file can keep, driven through the real app.
import { expect, test, type Page } from '@playwright/test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inspectPdf } from '../../src/engine/inspect';
import { findEverywhere, pageTexts } from '../unit/support/inspect';
import { answerDialogs, blockedRequests, closeApp, fixtureHashes, goTo, launch, openFixture, SCREENS, waitForFirstPage, type Running } from './helpers';

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
const screen = (win: Page) => win.getByTestId('clean-screen');
const carriesOf = async (file: string) => (await inspectPdf({ id: 'x', name: 'x.pdf', bytes: read(file) })).carries;

async function cleanAndSave(run: Running, name: string): Promise<string> {
  const target = path.join(outDir(), name);
  await answerDialogs(run.app, { saveAs: target });
  await screen(run.win).getByRole('button', { name: 'Clean up and save…' }).click();
  const review = run.win.getByTestId('review-dialog');
  await expect(review).toContainText('What the cleaned file carries');
  await review.getByRole('button', { name: 'Choose where to save…' }).click();
  await expect(run.win.getByTestId('message')).toContainText(`Saved ${name}`);
  return target;
}

test('clean up everything: what the new file carries reads None, and none of it is left in the file', async ({}, info) => {
  const run = (current = await launch(info.project.name));
  const { app, win } = run;
  await openFixture(run, 'carries.pdf');
  await waitForFirstPage(win);
  await goTo(win, 'Clean up');

  // What the file carries, with a choice for each.
  await expect(screen(win).getByTestId('clean-found-attachments')).toHaveText('1 file attached to pages, 1 file attached to the whole document.');
  await expect(screen(win).getByTestId('clean-found-formFields')).toHaveText('2 fields, 1 filled in.');
  await expect(screen(win).getByTestId('clean-found-layers')).toHaveText('2 layers, 1 hidden.');
  await expect(screen(win).getByTestId('clean-found-bookmarks')).toHaveText('2 bookmarks.');
  await expect(screen(win).getByTestId('clean-found-pagedata')).toHaveText('None.');
  await expect(screen(win).getByRole('button', { name: 'Clean up and save…' })).toBeDisabled();
  await screen(win).getByRole('button', { name: 'Choose everything' }).click();
  await expect(screen(win).getByLabel("Remove the document's details (both copies, including any non-standard ones)")).toBeChecked();
  await expect(screen(win).getByRole('radiogroup', { name: 'Form fields' }).getByLabel('Remove')).toBeChecked();
  await win.screenshot({ path: path.join(SCREENS, `clean-${info.project.name}.png`), fullPage: true });

  const target = await cleanAndSave(run, 'cleaned.pdf');
  const message = win.getByTestId('message');
  await expect(message).toContainText("Removed: the document's details; 1 file attached to pages; 2 form fields; 2 comments; 1 hidden layer and what was on it; 2 bookmarks.");

  const after = await carriesOf(target);
  expect(after.details.map((d) => d.key)).toEqual(['Creator', 'Producer', 'CreationDate', 'ModDate']);
  expect(after).toMatchObject({ attachments: [], formFields: [], actions: [], bookmarks: 0, pageData: 0, comments: { total: 0 } });
  expect(after.layers).toEqual([{ name: 'Visible layer', hidden: false }]);
  const bytes = read(target);
  for (const text of ['CARRIES-OLD-TITLE', 'Fixture Company Ltd', 'ATTACHMENT-SECRET-TEXT', 'PAGE-ATTACHMENT-TEXT', 'FIELD-VALUE', 'A fixture note', 'HIDDEN-LAYER-TEXT', 'Chapter one', 'CARRIES SCRIPT']) {
    expect(await findEverywhere(bytes, text), text).toEqual([]);
  }
  expect((await pageTexts(bytes))[0]).toContain('VISIBLE-LAYER-TEXT');
  // The new file opens, and its Clean up screen has nothing left to remove but its visible layer.
  await expect(win.locator('.sf-doc-name')).toHaveText('cleaned.pdf');
  expect(await blockedRequests(app)).toEqual([]);
});

test('clean up only some things: the rest stays as it was', async ({}, info) => {
  const run = (current = await launch(info.project.name));
  const { win } = run;
  await openFixture(run, 'carries.pdf');
  await waitForFirstPage(win);
  await goTo(win, 'Clean up');
  await screen(win).getByLabel('Remove the bookmarks').check();
  await screen(win).getByRole('radiogroup', { name: 'Comments' }).getByLabel('Burn into the page').check();
  const target = await cleanAndSave(run, 'some.pdf');
  await expect(win.getByTestId('message')).toContainText('Removed: 2 bookmarks.');
  await expect(win.getByTestId('message')).toContainText('2 comments were burned into the page');
  const after = await carriesOf(target);
  expect(after).toMatchObject({ bookmarks: 0, comments: { total: 0 } });
  // Untouched: the details, the file attached to page 2, both layers.
  expect(after.details.find((d) => d.key === 'Title')?.value).toBe('CARRIES-OLD-TITLE');
  expect(after.attachments.map((a) => a.name)).toEqual(['page-file.txt']);
  expect(after.layers).toEqual([
    { name: 'Visible layer', hidden: false },
    { name: 'Hidden layer', hidden: true },
  ]);
});

test('a redacted file can keep its details and bookmarks when chosen', async ({}, info) => {
  const run = (current = await launch(info.project.name));
  const { app, win } = run;
  await openFixture(run, 'carries.pdf');
  await waitForFirstPage(win);
  await win.getByRole('radiogroup', { name: 'Tools' }).getByRole('radio', { name: 'Redact' }).click();
  const bar = win.getByRole('toolbar', { name: 'Redact' });
  await bar.getByLabel('Text to find and mark').fill('CARRIES-PAGE-1');
  await bar.getByRole('button', { name: 'Mark all' }).click();
  await bar.getByRole('button', { name: 'Review and redact…' }).click();
  const marks = win.getByTestId('marks-dialog');
  for (const label of ["The document's details", 'Bookmarks', 'Comments on pages without marks']) await expect(marks.getByLabel(label)).not.toBeChecked();
  await marks.getByLabel("The document's details").check();
  await marks.getByLabel('Bookmarks').check();
  await marks.getByRole('button', { name: 'Redact…' }).click();
  const summary = win.getByTestId('review-dialog');
  await expect(summary).toContainText("Kept, as you chose: the document's details, bookmarks.", { timeout: 30_000 });
  const target = path.join(outDir(), 'kept.pdf');
  await answerDialogs(app, { saveAs: target });
  await summary.getByRole('button', { name: 'Choose where to save…' }).click();
  await expect(win.getByTestId('message')).toContainText('Saved kept.pdf');
  const after = await carriesOf(target);
  expect(after.details.find((d) => d.key === 'Title')?.value).toBe('CARRIES-OLD-TITLE');
  expect(after.bookmarks).toBe(2);
  expect(after.comments.total).toBe(0);
  expect(await findEverywhere(read(target), 'CARRIES-PAGE-1')).toEqual([]);
});
