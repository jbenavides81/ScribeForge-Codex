// Stop 1e: redaction, driven through the real app. Every redacted file is then searched for the
// redacted text in every string and decompressed stream, and read back with pdf.js.
import { expect, test, type Page } from '@playwright/test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { findEverywhere, links, pageTexts } from '../unit/support/inspect';
import {
  answerDialogs,
  choose,
  blockedRequests,
  closeApp,
  dialogLog,
  FIXTURES,
  fixtureHashes,
  goTo,
  launch,
  openFixture,
  waitForFirstPage,
  type Running,
} from './helpers';

const TERM = 'REDACT-ME-TERM';
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
const toolbar = (win: Page) => win.getByRole('toolbar', { name: 'Redact' });
const marks = (win: Page) => win.locator('.sf-redact-mark');

async function startRedacting(run: Running, name: string): Promise<void> {
  await openFixture(run, name);
  await waitForFirstPage(run.win);
  await run.win.getByRole('radiogroup', { name: 'Tools' }).getByRole('radio', { name: 'Redact' }).click();
  await expect(toolbar(run.win)).toBeVisible();
}

async function findAndMark(win: Page, term: string): Promise<void> {
  await toolbar(win).getByLabel('Text to find and mark').fill(term);
  await toolbar(win).getByRole('button', { name: 'Mark all' }).click();
}

/** Review the marks, redact, and go past the summary to the Save dialog. */
async function redactAndSave(win: Page): Promise<void> {
  await toolbar(win).getByRole('button', { name: 'Review and redact…' }).click();
  await win.getByTestId('marks-dialog').getByRole('button', { name: 'Redact…' }).click();
  await win.getByTestId('review-dialog').getByRole('button', { name: 'Choose where to save…' }).click({ timeout: 30_000 });
}

test('find and mark, then redact: the term is found nowhere and the unmarked page is unchanged', async ({}, info) => {
  const run = (current = await launch(info.project.name));
  const { app, win } = run;
  await startRedacting(run, 'redaction.pdf');
  await findAndMark(win, TERM);
  await expect(win.getByTestId('redact-hint')).toHaveText('Marked 4 matches on 2 pages.');
  await expect(marks(win)).toHaveCount(4);

  // The marks are listed by page before anything happens.
  await toolbar(win).getByRole('button', { name: 'Review and redact…' }).click();
  const list = win.getByTestId('marks-dialog');
  await expect(list).toContainText('Redact 4 marks?');
  await expect(list.locator('h3')).toHaveText(['Page 2', 'Page 3']);
  await list.getByRole('button', { name: 'Redact…' }).click();

  // The summary: what was redacted and what the file still carries.
  const summary = win.getByTestId('review-dialog');
  await expect(summary).toContainText('What the redacted file carries', { timeout: 30_000 });
  await expect(summary).toContainText('4 marks on 2 pages are blacked out. Those pages are now pictures (200 dpi)');
  await expect(summary).toContainText("Left out, as in every redacted file: the document's details");
  await expect(summary.locator('[data-carries="comments"]')).toContainText('None');
  await expect(summary.locator('[data-carries="bookmarks"]')).toContainText('None');
  await expect(summary.locator('[data-carries="attachments"]')).toContainText('None');

  const target = path.join(outDir(), 'redacted.pdf');
  await answerDialogs(app, { saveAs: target });
  await summary.getByRole('button', { name: 'Choose where to save…' }).click();
  await expect(win.getByTestId('message')).toContainText('Saved redacted.pdf (3 pages, 2 pages redacted).');
  expect((await dialogLog(app)).find((d) => d.kind === 'save')?.defaultPath).toBe(path.join(FIXTURES, 'redaction (redacted).pdf'));

  const bytes = read(target);
  expect(await findEverywhere(bytes, TERM)).toEqual([]);
  const texts = await pageTexts(bytes);
  expect(texts[0]).toBe((await pageTexts(read(path.join(FIXTURES, 'redaction.pdf'))))[0]);
  expect(texts.slice(1)).toEqual(['', '']);
  expect((await links(bytes)).filter((l) => l.kind === 'page').map((l) => [l.page, l.target])).toEqual([[1, 3]]);

  // The redacted file opens, with no marks left.
  await expect(win.locator('.sf-doc-name')).toHaveText('redacted.pdf');
  await expect(marks(win)).toHaveCount(0);
  expect(await blockedRequests(app)).toEqual([]);
});

test('mark an area and selected text, check them, remove one, and redact the rest', async ({}, info) => {
  const run = (current = await launch(info.project.name));
  const { app, win } = run;
  await startRedacting(run, 'normal.pdf');
  const page1 = win.locator('.page[data-page-number="1"]');

  // Mark area: drag a box.
  await toolbar(win).getByRole('button', { name: 'Mark area', exact: true }).click();
  await expect(win.getByTestId('redact-hint')).toHaveText('Drag across the part of the page to black out.');
  const box = (await page1.boundingBox())!;
  await win.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await win.mouse.down();
  await win.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.6, { steps: 5 });
  await win.mouse.up();
  await expect(marks(win)).toHaveCount(1);
  await expect(marks(win).first()).toHaveAttribute('data-kind', 'area');

  // Mark text: covers exactly the selected letters.
  await toolbar(win).getByRole('button', { name: 'Mark text', exact: true }).click();
  await page1.locator('.textLayer span', { hasText: 'The forge keeps an anvil by the door.' }).first().evaluate((span) => {
    const range = document.createRange();
    range.selectNodeContents(span);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
  });
  await win.getByTestId('viewer').dispatchEvent('mouseup');
  await expect(marks(win)).toHaveCount(2);
  await expect(marks(win).nth(1)).toHaveAttribute('aria-label', 'Redaction mark on page 1: “The forge keeps an anvil by the door.”');

  // Undo and redo; select a mark, Delete, then Ctrl+Z brings it back.
  await toolbar(win).getByRole('button', { name: 'Undo' }).click();
  await expect(marks(win)).toHaveCount(1);
  await toolbar(win).getByRole('button', { name: 'Redo' }).click();
  await expect(marks(win)).toHaveCount(2);
  await toolbar(win).getByRole('button', { name: 'Select', exact: true }).click();
  await marks(win).first().locator('.sf-redact-part').click();
  await expect(win.getByTestId('mark-panel')).toContainText('Redaction mark on page 1');
  await win.keyboard.press('Delete');
  await expect(marks(win)).toHaveCount(1);
  await win.keyboard.press('Control+z');
  await expect(marks(win)).toHaveCount(2);

  // In the list, remove the area; redact the text only.
  await toolbar(win).getByRole('button', { name: 'Review and redact…' }).click();
  const list = win.getByTestId('marks-dialog');
  await list.getByRole('button', { name: 'Remove Area on page 1' }).click();
  await expect(list).toContainText('Redact 1 mark?');
  const target = path.join(outDir(), 'normal-redacted.pdf');
  await answerDialogs(app, { saveAs: target });
  await list.getByRole('button', { name: 'Redact…' }).click();
  await win.getByTestId('review-dialog').getByRole('button', { name: 'Choose where to save…' }).click({ timeout: 30_000 });
  await expect(win.getByTestId('message')).toContainText('(3 pages, 1 page redacted)');

  const bytes = read(target);
  expect(await findEverywhere(bytes, 'anvil by the door')).toEqual([]);
  const texts = await pageTexts(bytes);
  expect(texts[0]).toBe(''); // page 1 is a picture now
  expect(texts[1]).toContain('A second anvil stands in the corner.');
});

test('nothing is saved until the end; marks count as unsaved; the resolution comes from Settings', async ({}, info) => {
  const run = (current = await launch(info.project.name));
  const { app, win } = run;
  await goTo(win, 'Settings');
  await choose(win.getByLabel('300 dpi (sharper)'));
  await startRedacting(run, 'redaction.pdf');
  await findAndMark(win, TERM);
  await expect(marks(win)).toHaveCount(4);

  // Cancel in the list, and Cancel in the summary: no Save dialog either time.
  await toolbar(win).getByRole('button', { name: 'Review and redact…' }).click();
  await win.getByTestId('marks-dialog').getByRole('button', { name: 'Cancel' }).click();
  await toolbar(win).getByRole('button', { name: 'Review and redact…' }).click();
  await win.getByTestId('marks-dialog').getByRole('button', { name: 'Redact…' }).click();
  const summary = win.getByTestId('review-dialog');
  await expect(summary).toContainText('(300 dpi)', { timeout: 30_000 });
  await summary.getByRole('button', { name: 'Cancel' }).click();
  expect((await dialogLog(app)).filter((d) => d.kind === 'save')).toEqual([]);
  await expect(marks(win)).toHaveCount(4);

  // Marks are unsaved work: closing the document asks first.
  await win.getByRole('button', { name: 'Close document' }).click();
  await expect(win.getByTestId('confirm-dialog')).toContainText('redaction marks');
  await win.getByTestId('confirm-dialog').getByRole('button', { name: 'Keep editing' }).click();

  // Annotate mode still shows the marks, but they can't be clicked there.
  await win.getByRole('radiogroup', { name: 'Tools' }).getByRole('radio', { name: 'Annotate' }).click();
  await expect(marks(win)).toHaveCount(4);
  await expect(win.getByTestId('redact-layer')).not.toHaveClass(/sf-redact-interactive/);
});

test('a page turned on the Pages screen is redacted turned, and pages deleted there stay out', async ({}, info) => {
  const run = (current = await launch(info.project.name));
  const { app, win } = run;
  await startRedacting(run, 'redaction.pdf');
  await findAndMark(win, TERM);
  await expect(marks(win)).toHaveCount(4);
  await goTo(win, 'Pages');
  const tile = (n: number) => win.getByRole('option', { name: new RegExp(`^Page ${n}(,|$)`) });
  await tile(3).click();
  await win.getByRole('button', { name: 'Delete' }).click();
  await tile(2).click();
  await win.getByRole('button', { name: 'Rotate right' }).click();
  await goTo(win, 'Document');
  const target = path.join(outDir(), 'turned.pdf');
  await answerDialogs(app, { saveAs: target });
  await redactAndSave(win);
  await expect(win.getByTestId('message')).toContainText('(2 pages, 1 page redacted)');
  const bytes = read(target);
  expect(await findEverywhere(bytes, TERM)).toEqual([]);
  const { PDFDocument } = await import('@cantoo/pdf-lib');
  expect((await PDFDocument.load(bytes)).getPage(1).getRotation().angle).toBe(90);
});
