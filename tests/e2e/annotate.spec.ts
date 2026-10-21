// Stop 1c: annotating on the Document screen, driven through the real app. Every saved file is
// then read back with pdf.js (standing in for any other PDF reader).
import { expect, test, type Page } from '@playwright/test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { annotations, pageIds, strayPages, textPosition } from '../unit/support/inspect';
import { answerDialogs, closeApp, dialogLog, fixtureHashes, goTo, launch, openFixture, passReview, SCREENS, waitForFirstPage, type Running } from './helpers';

// The app of the test running now, so a failed test still closes its window.
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

const AUTHOR = 'Pat Tester';
const outDir = () => mkdtempSync(path.join(tmpdir(), 'scribeforge-e2e-out-'));
const read = (p: string) => new Uint8Array(readFileSync(p));
const toolbar = (win: Page) => win.getByRole('toolbar', { name: 'Annotate' });
const tool = (win: Page, name: string) => toolbar(win).getByRole('button', { name, exact: true });
const panel = (win: Page) => win.getByTestId('annot-panel');
const textSpan = (win: Page, page: number, needle: string) => win.locator(`.page[data-page-number="${page}"] .textLayer span`, { hasText: needle }).first();

async function setAuthor(win: Page, name: string): Promise<void> {
  await goTo(win, 'Settings');
  const field = win.getByLabel('Your name on annotations');
  await field.fill(name);
  await field.press('Enter');
}

async function openDocument(run: Running, name: string): Promise<void> {
  await openFixture(run, name);
  await waitForFirstPage(run.win);
}

async function showPage(win: Page, n: number): Promise<void> {
  const field = win.getByLabel('Page number');
  await field.fill(String(n));
  await field.press('Enter');
  await win.locator(`.page[data-page-number="${n}"] .textLayer span`).first().waitFor();
}

/** Selects text with the mouse, the way a person would. */
async function dragAcross(win: Page, page: number, needle: string): Promise<void> {
  const box = await textSpan(win, page, needle).boundingBox();
  if (!box) throw new Error(`no text "${needle}" on page ${page}`);
  await win.mouse.move(box.x + 1, box.y + box.height / 2);
  await win.mouse.down();
  await win.mouse.move(box.x + box.width - 1, box.y + box.height / 2, { steps: 6 });
  await win.mouse.up();
}

/** Selects all of a piece of text directly (for turned pages, where dragging is awkward). */
async function selectText(win: Page, page: number, needle: string): Promise<void> {
  await textSpan(win, page, needle).evaluate((span) => {
    const range = document.createRange();
    range.selectNodeContents(span);
    const selection = window.getSelection() as Selection;
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await win.getByTestId('viewer').dispatchEvent('mouseup');
}

/** Clicks on a page, `fx` and `fy` of the way across and down it (scrolled into view first). */
async function clickPage(win: Page, page: number, fx: number, fy: number): Promise<void> {
  const target = win.locator(`.page[data-page-number="${page}"]`);
  await target.evaluate(
    (el, [x, y]) => {
      const scroller = el.closest('.sf-viewer-container') as HTMLElement;
      const r = el.getBoundingClientRect();
      const view = scroller.getBoundingClientRect();
      scroller.scrollTop += r.top + r.height * y - (view.top + view.height / 2);
      scroller.scrollLeft += r.left + r.width * x - (view.left + view.width / 2);
    },
    [fx, fy],
  );
  await win.waitForTimeout(150);
  const box = await target.boundingBox();
  if (!box) throw new Error(`page ${page} not shown`);
  await win.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
}

/** True when the saved annotation's rectangle covers the text it was made from. */
function covers(rect: number[], text: { x: number; y: number; width: number; height: number }): boolean {
  const [x1, y1, x2, y2] = rect;
  const across = (a: number, b: number, lo: number, hi: number) => Math.min(a, b) <= lo + 2 && Math.max(a, b) >= hi - 2;
  return across(x1, x2, text.x, text.x + text.width) && Math.min(y1, y2) <= text.y + 1 && Math.max(y1, y2) >= text.y + text.height * 0.6;
}

test('highlight, note and text box, saved as a new file that other readers show', async ({}, info) => {
  const run = (current = await launch(info.project.name));
  const { app, win } = run;
  await setAuthor(win, AUTHOR);
  await openDocument(run, 'links.pdf');

  // Highlight: choose the tool and a colour, then drag across some text.
  await tool(win, 'Highlight').click();
  await expect(win.getByTestId('annotate-hint')).toHaveText('Select text to highlight it.');
  await toolbar(win).getByRole('radio', { name: 'Green' }).click();
  await dragAcross(win, 1, 'UNIQUE-PAGE-1');
  const highlight = win.locator('.sf-annot-highlight');
  await expect(highlight).toHaveCount(1);
  // Drawn over the text it marks.
  const span = await textSpan(win, 1, 'UNIQUE-PAGE-1').boundingBox();
  const mark = await highlight.locator('.sf-annot-part').first().boundingBox();
  expect(mark && span && Math.abs(mark.y + mark.height / 2 - (span.y + span.height / 2)) < span.height / 2).toBe(true);
  // Nothing stays selected afterwards.
  expect(await win.evaluate(() => window.getSelection()?.isCollapsed)).toBe(true);
  // Still on the text after zooming in.
  await win.getByRole('button', { name: 'Zoom in' }).click();
  await expect(win.getByLabel('Zoom', { exact: true })).not.toHaveValue('page-width');
  await win.waitForTimeout(400);
  const spanZoomed = (await textSpan(win, 1, 'UNIQUE-PAGE-1').boundingBox())!;
  const markZoomed = (await highlight.locator('.sf-annot-part').first().boundingBox())!;
  expect(markZoomed.width).toBeGreaterThan(mark!.width);
  expect(Math.abs(markZoomed.y + markZoomed.height / 2 - (spanZoomed.y + spanZoomed.height / 2))).toBeLessThan(spanZoomed.height / 2);
  expect(Math.abs(markZoomed.x - spanZoomed.x)).toBeLessThan(spanZoomed.height);
  await win.getByLabel('Zoom', { exact: true }).selectOption('page-width');

  // Select it to add a comment.
  await tool(win, 'Select').click();
  await highlight.locator('.sf-annot-part').first().click();
  await expect(panel(win)).toContainText('Highlight on page 1');
  await panel(win).getByLabel('Comment').fill('Check this heading');
  await panel(win).getByRole('button', { name: 'Done' }).click();
  await expect(panel(win)).toHaveCount(0);

  // Note: the next click on the page places it, and typing goes straight in.
  await tool(win, 'Note').click();
  await expect(win.getByTestId('viewer')).toHaveClass(/sf-placing/);
  await clickPage(win, 1, 0.8, 0.3);
  await expect(panel(win)).toContainText('Note on page 1');
  await expect(panel(win).getByLabel('Comment')).toBeFocused();
  await win.keyboard.type('Ask about this page');
  await panel(win).getByRole('button', { name: 'Done' }).click();
  await expect(tool(win, 'Select')).toHaveAttribute('aria-pressed', 'true');

  // Text box, in red.
  await toolbar(win).getByRole('radio', { name: 'Red', exact: true }).click();
  await tool(win, 'Text box').click();
  await clickPage(win, 1, 0.3, 0.6);
  await expect(panel(win)).toContainText('Text box on page 1');
  await panel(win).getByLabel('Text', { exact: true }).fill('Approved by the team');
  await panel(win).getByRole('button', { name: 'Done' }).click();
  await expect(win.locator('.sf-annot-text')).toHaveText('Approved by the team');
  await expect(win.locator('.sf-annot')).toHaveCount(3);

  // Unsaved: the Pages screen doesn't get the page-changes dot, but closing asks first.
  await expect(win.getByRole('button', { name: 'Pages', exact: true }).locator('.sf-dot')).toHaveCount(0);
  await win.getByRole('button', { name: 'Close document' }).click();
  await expect(win.getByTestId('confirm-dialog')).toContainText('pages, annotations, details or redaction marks');
  await win.getByTestId('confirm-dialog').getByRole('button', { name: 'Keep editing' }).click();

  // Save. The original is untouched (checked after all tests) and the new file opens.
  const target = path.join(outDir(), 'annotated.pdf');
  await answerDialogs(app, { saveAs: target });
  await toolbar(win).getByRole('button', { name: 'Save as new file…' }).click();
  await passReview(win);
  await expect(win.getByTestId('message')).toContainText('Saved annotated.pdf (6 pages).');
  await expect(win.getByTestId('message')).toContainText('3 annotations saved with the pages.');
  await expect(win.locator('.sf-doc-name')).toHaveText('annotated.pdf');
  await expect(win.locator('.sf-annot')).toHaveCount(0);

  const bytes = read(target);
  const saved = (await annotations(bytes)).filter((a) => a.author === AUTHOR);
  expect(saved.map((a) => [a.page, a.subtype, a.contents])).toEqual([
    [1, 'Highlight', 'Check this heading'],
    [1, 'Text', 'Ask about this page'],
    [1, 'FreeText', 'Approved by the team'],
  ]);
  expect(saved[0].colour).toEqual([155, 229, 143]); // green
  expect(covers(saved[0].rect, (await textPosition(bytes, 1, 'UNIQUE-PAGE-1'))!)).toBe(true);
  expect(await strayPages(bytes)).toBe(0);

  // The reopened file shows them through pdf.js, like any reader.
  await expect(win.locator('.page[data-page-number="1"] .annotationLayer [data-annotation-id]').first()).toBeAttached();
  await waitForFirstPage(win);
  await win.getByTestId('message').getByRole('button', { name: 'Dismiss message' }).click();
  await win.getByLabel('Zoom', { exact: true }).selectOption('page-fit');
  await win.waitForTimeout(500);
  await win.screenshot({ path: path.join(SCREENS, 'annotations-saved.png') });
});

test('marks on a turned page land on the text, and annotations follow page changes', async ({}, info) => {
  const run = (current = await launch(info.project.name));
  const { app, win } = run;
  await openDocument(run, 'links.pdf');

  // Page 2 is turned 90° in the file.
  await tool(win, 'Underline').click();
  await showPage(win, 2);
  await selectText(win, 2, 'UNIQUE-PAGE-2');
  await expect(win.locator('.sf-annot-underline')).toHaveCount(1);
  // The text reads down the screen here, so the line runs down beside it, not across its end.
  const line = (await win.locator('.sf-annot-underline .sf-annot-line').first().boundingBox())!;
  const marked = (await textSpan(win, 2, 'UNIQUE-PAGE-2').boundingBox())!;
  expect(line.height).toBeGreaterThan(line.width * 5);
  expect(line.height).toBeGreaterThan(marked.height * 0.8);
  await tool(win, 'Strikeout').click();
  await showPage(win, 5);
  await selectText(win, 5, 'UNIQUE-PAGE-5');
  await expect(win.locator('.sf-annot-strikeout')).toHaveCount(1);

  // On the Pages screen: delete page 5 and move page 2 to the front.
  await goTo(win, 'Pages');
  const tile = (n: number) => win.getByRole('option', { name: new RegExp(`^Page ${n}(,|$)`) });
  await tile(5).click();
  await win.getByRole('button', { name: 'Delete' }).click();
  await tile(2).dragTo(tile(1), { targetPosition: { x: 8, y: 60 } });
  await expect(tile(1)).toHaveAccessibleName(/^Page 1, was page 2/);

  // The Document screen says it still shows the file as opened.
  await goTo(win, 'Document');
  await expect(win.getByTestId('pages-banner')).toBeVisible();

  const target = path.join(outDir(), 'moved.pdf');
  await answerDialogs(app, { saveAs: target });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('menu', 'save'));
  await passReview(win);
  await expect(win.getByTestId('message')).toContainText('1 annotation saved with the pages.');
  await expect(win.getByTestId('message')).toContainText("1 annotation was on pages that aren't in the new file, so it was left out.");
  expect((await dialogLog(app)).filter((d) => d.kind === 'save')).toHaveLength(1);

  const bytes = read(target);
  expect(await pageIds(bytes)).toEqual(['UNIQUE-PAGE-2', 'UNIQUE-PAGE-1', 'UNIQUE-PAGE-3', 'UNIQUE-PAGE-4', 'UNIQUE-PAGE-6']);
  const saved = (await annotations(bytes)).filter((a) => a.subtype === 'Underline' || a.subtype === 'StrikeOut');
  expect(saved.map((a) => [a.page, a.subtype])).toEqual([[1, 'Underline']]);
  expect(covers(saved[0].rect, (await textPosition(bytes, 1, 'UNIQUE-PAGE-2'))!)).toBe(true);
  // Saved along the text too: the quad's top-left corner is straight above its bottom-left one.
  const [ulx, uly, , , llx, lly] = saved[0].quadPoints;
  expect(Math.abs(ulx - llx)).toBeLessThan(1);
  expect(uly - lly).toBeGreaterThan(5);
});

test('Delete, Escape, undo and redo; empty text boxes are not saved', async ({}, info) => {
  const run = (current = await launch(info.project.name));
  const { app, win } = run;
  await openDocument(run, 'normal.pdf');
  const marks = win.locator('.sf-annot');

  await tool(win, 'Note').click();
  await clickPage(win, 1, 0.5, 0.2);
  await panel(win).getByLabel('Comment').fill('first');
  await panel(win).getByRole('button', { name: 'Done' }).click();
  // Typing more is one undo step, not one per key.
  await marks.first().click();
  await expect(panel(win).getByLabel('Comment')).not.toBeFocused();
  await panel(win).getByLabel('Comment').press('End');
  await panel(win).getByLabel('Comment').pressSequentially(' and more');
  await expect(marks.first()).toHaveAttribute('aria-label', 'Note on page 1: first and more');
  await marks.first().focus();
  await win.keyboard.press('Escape');
  await expect(panel(win)).toHaveCount(0);
  await toolbar(win).getByRole('button', { name: 'Undo' }).click();
  await expect(marks).toHaveCount(1);
  await expect(marks.first()).toHaveAttribute('aria-label', 'Note on page 1: first');

  // Escape leaves a placing tool without placing anything.
  await tool(win, 'Text box').click();
  await win.keyboard.press('Escape');
  await expect(tool(win, 'Select')).toHaveAttribute('aria-pressed', 'true');

  // Delete removes the selected annotation; Ctrl+Z brings it back, Ctrl+Y removes it again.
  await marks.first().click();
  await expect(panel(win)).toBeVisible();
  await win.keyboard.press('Delete');
  await expect(marks).toHaveCount(0);
  await win.keyboard.press('Control+z');
  await expect(marks).toHaveCount(1);
  await win.keyboard.press('Control+y');
  await expect(marks).toHaveCount(0);
  await win.keyboard.press('Control+z');

  // An empty text box shows a dashed outline, but isn't saved.
  await tool(win, 'Text box').click();
  await clickPage(win, 2, 0.4, 0.4);
  await expect(panel(win)).toContainText("An empty text box isn't saved.");
  await panel(win).getByRole('button', { name: 'Done' }).click();
  await expect(win.locator('.sf-annot-text[data-empty="true"]')).toHaveCount(1);

  const target = path.join(outDir(), 'notes.pdf');
  await answerDialogs(app, { saveAs: target });
  await toolbar(win).getByRole('button', { name: 'Save as new file…' }).click();
  await passReview(win);
  await expect(win.getByTestId('message')).toContainText('1 annotation saved with the pages.');
  const saved = await annotations(read(target));
  expect(saved.map((a) => [a.page, a.subtype, a.contents, a.author])).toEqual([[1, 'Text', 'first', '']]);
});
