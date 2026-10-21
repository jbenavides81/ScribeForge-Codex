// Stop 2b: the full set of annotations, driven through the real app. Every saved file is read
// back with pdf.js, standing in for any PDF reader.
import { expect, test, type Page } from '@playwright/test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { buildPdf } from '../../src/engine/build';
import type { AnnotationInput, Quad } from '../../src/engine/types';
import { findEverywhere, fixture, ROOT } from '../unit/support/inspect';
import { answerDialogs, blockedRequests, chooseInOpenDialog, closeApp, fixtureHashes, goTo, launch, openFixture, passReview, SCREENS, waitForFirstPage, type Running } from './helpers';

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
const FONTS = `${path.join(ROOT, 'node_modules/pdfjs-dist/standard_fonts').replace(/\\/g, '/')}/`;
const outDir = () => mkdtempSync(path.join(tmpdir(), 'scribeforge-e2e-out-'));
const read = (p: string) => new Uint8Array(readFileSync(p));
const toolbar = (win: Page) => win.getByRole('toolbar', { name: 'Annotate' });
const tool = (win: Page, name: string) => toolbar(win).getByRole('button', { name, exact: true });
const panel = (win: Page) => win.getByTestId('annot-panel');
const comments = (win: Page) => win.getByTestId('comments-panel');
const page1 = (win: Page) => win.locator('.page[data-page-number="1"]');

type Read = { id: string; subtype: string; contents: string; author: string; colour: number[]; rect: number[]; inReplyTo?: string; data: Record<string, unknown> };

/** Every annotation on page 1, as pdf.js reads it. */
async function readPage1(bytes: Uint8Array): Promise<Read[]> {
  const doc = await pdfjs.getDocument({ data: bytes.slice(), standardFontDataUrl: FONTS, useWorkerFetch: false, verbosity: 0 }).promise;
  const list = await (await doc.getPage(1)).getAnnotations();
  await doc.loadingTask.destroy();
  return list.map((a) => ({
    id: a.id,
    subtype: a.subtype,
    contents: a.contentsObj?.str ?? '',
    author: a.titleObj?.str ?? '',
    colour: a.color ? [...a.color] : [],
    rect: [...a.rect],
    inReplyTo: a.inReplyTo ?? undefined,
    data: a,
  }));
}

async function setAuthor(win: Page, name: string): Promise<void> {
  await goTo(win, 'Settings');
  const field = win.getByLabel('Your name on annotations');
  await field.fill(name);
  await field.press('Enter');
}

async function open(run: Running, name: string): Promise<void> {
  await openFixture(run, name);
  await waitForFirstPage(run.win);
}

/** Drags on page 1 between two points given as fractions of the page. */
async function drag(win: Page, from: [number, number], to: [number, number], steps = 8): Promise<void> {
  const box = (await page1(win).boundingBox())!;
  await win.mouse.move(box.x + box.width * from[0], box.y + box.height * from[1]);
  await win.mouse.down();
  await win.mouse.move(box.x + box.width * to[0], box.y + box.height * to[1], { steps });
  await win.mouse.up();
}

async function clickPage(win: Page, fx: number, fy: number): Promise<void> {
  const box = (await page1(win).boundingBox())!;
  await win.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
}

/** Selects all of a piece of text on page 1 and lets go, as a drag across it would. */
async function selectText(win: Page, needle: string): Promise<void> {
  await page1(win).locator('.textLayer span', { hasText: needle }).first().evaluate((span) => {
    const range = document.createRange();
    range.selectNodeContents(span);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
  });
  await win.getByTestId('viewer').dispatchEvent('mouseup');
}

async function save(run: Running, name: string): Promise<string> {
  const target = path.join(outDir(), name);
  await answerDialogs(run.app, { saveAs: target });
  await toolbar(run.win).getByRole('button', { name: 'Save as new file…' }).click();
  await passReview(run.win);
  await expect(run.win.getByTestId('message')).toContainText(`Saved ${name}`);
  return target;
}

test('drawings, shapes and stamps are saved as standard annotations other readers show', async ({}, info) => {
  const run = (current = await launch(info.project.name));
  const { app, win } = run;
  await setAuthor(win, AUTHOR);
  await open(run, 'links.pdf');

  // Draw: two strokes make one drawing.
  await tool(win, 'Draw').click();
  await expect(win.getByTestId('annotate-hint')).toContainText('Draw on the page');
  await toolbar(win).getByRole('radio', { name: 'Blue' }).click();
  await drag(win, [0.1, 0.3], [0.3, 0.34]);
  await drag(win, [0.1, 0.37], [0.3, 0.39]);
  await expect(win.locator('.sf-annot-ink')).toHaveCount(1);
  await expect(win.locator('.sf-annot-ink polyline:not(.sf-annot-hit)')).toHaveCount(2);

  // Shapes: a filled rectangle, a thick ellipse and an arrow.
  await tool(win, 'Shape').click();
  await toolbar(win).getByLabel('Shape').selectOption('rect');
  await toolbar(win).getByLabel('Fill').check();
  await drag(win, [0.4, 0.3], [0.6, 0.38]);
  await expect(panel(win)).toContainText('Rectangle on page 1');
  await panel(win).getByRole('button', { name: 'Done' }).click();
  await tool(win, 'Shape').click();
  await toolbar(win).getByLabel('Shape').selectOption('ellipse');
  await toolbar(win).getByLabel('Thickness').selectOption('4');
  await drag(win, [0.65, 0.3], [0.85, 0.38]);
  await expect(panel(win)).toContainText('Ellipse on page 1');
  await panel(win).getByRole('button', { name: 'Done' }).click();
  await tool(win, 'Shape').click();
  await toolbar(win).getByLabel('Shape').selectOption('arrow');
  await toolbar(win).getByLabel('Thickness').selectOption('2');
  await drag(win, [0.2, 0.47], [0.45, 0.42]);
  await panel(win).getByLabel('Comment').fill('Look here');
  await panel(win).getByRole('button', { name: 'Done' }).click();

  // Stamps: Approved, and one with its own text.
  await tool(win, 'Stamp').click();
  await toolbar(win).getByLabel('Stamp', { exact: true }).selectOption('approved');
  await clickPage(win, 0.55, 0.42);
  await expect(panel(win)).toContainText('Stamp on page 1');
  await expect(win.locator('.sf-annot-stamp').first()).toContainText('Approved');
  await panel(win).getByRole('button', { name: 'Done' }).click();
  await tool(win, 'Stamp').click();
  await toolbar(win).getByLabel('Stamp', { exact: true }).selectOption('custom');
  await toolbar(win).getByLabel('Stamp text').fill('Paid in full');
  await clickPage(win, 0.1, 0.5);
  await expect(win.locator('.sf-annot-stamp').nth(1)).toContainText('Paid in full');
  await win.screenshot({ path: path.join(SCREENS, `annotate-full-${info.project.name}.png`) });

  const target = await save(run, 'drawn.pdf');
  await expect(win.getByTestId('message')).toContainText('6 annotations saved with the pages.');
  const mine = (await readPage1(read(target))).filter((a) => a.author === AUTHOR);
  expect(mine.map((a) => a.subtype)).toEqual(['Ink', 'Square', 'Circle', 'Line', 'Stamp', 'Stamp']);
  expect((mine[0].data.inkLists as unknown[]).length).toBe(2);
  expect(mine[0].colour).toEqual([28, 91, 176]); // blue ink
  expect(mine[3].contents).toBe('Look here');
  expect(mine[3].data.lineEndings).toEqual(['None', 'OpenArrow']);
  expect(mine[4].contents).toMatch(/^Approved, \w+ \d+, \d{4}$/);
  expect(mine[5].contents).toMatch(/^Paid in full, /);
  for (const a of mine) expect(a.data.hasAppearance, a.subtype).toBe(true);
  expect(await blockedRequests(app)).toEqual([]);
});

test('moving and resizing, with the mouse or the keyboard, and undo', async ({}, info) => {
  const run = (current = await launch(info.project.name));
  const { win } = run;
  await open(run, 'links.pdf');
  await tool(win, 'Stamp').click();
  await clickPage(win, 0.3, 0.2);
  const stamp = win.locator('.sf-annot-stamp');
  const at = async () => (await stamp.boundingBox())!;
  const placed = await at();

  // Drag it by its middle: it moves.
  await win.mouse.move(placed.x + placed.width / 2, placed.y + placed.height / 2);
  await win.mouse.down();
  await win.mouse.move(placed.x + placed.width / 2 - 80, placed.y + placed.height / 2 + 60, { steps: 6 });
  await win.mouse.up();
  const movedBox = await at();
  expect(movedBox.x - placed.x).toBeCloseTo(-80, 0);
  expect(movedBox.y - placed.y).toBeCloseTo(60, 0);
  expect(movedBox.width).toBeCloseTo(placed.width, 0);

  // Drag its bottom-right corner: it grows. (Away from the details panel, which sits on the right.)
  const corner = win.locator('.sf-annot-handle[data-handle="se"]');
  const c = (await corner.boundingBox())!;
  await win.mouse.move(c.x + c.width / 2, c.y + c.height / 2);
  await win.mouse.down();
  await win.mouse.move(c.x + c.width / 2 + 50, c.y + c.height / 2 + 30, { steps: 6 });
  await win.mouse.up();
  const grown = await at();
  expect(grown.width - movedBox.width).toBeCloseTo(50, 0);
  expect(grown.height - movedBox.height).toBeCloseTo(30, 0);

  // Each drag is one step to undo.
  await win.keyboard.press('Control+z');
  expect((await at()).width).toBeCloseTo(movedBox.width, 0);
  await win.keyboard.press('Control+z');
  expect((await at()).x).toBeCloseTo(placed.x, 0);
  await win.keyboard.press('Control+y');
  expect((await at()).x).toBeCloseTo(movedBox.x, 0);

  // The arrow keys move it too (Shift: further), and with Alt they resize it.
  await stamp.click();
  const before = await at();
  await win.keyboard.press('Shift+ArrowRight');
  await win.keyboard.press('ArrowDown');
  const nudged = await at();
  const scale = (await page1(win).boundingBox())!.width / 612;
  expect(nudged.x - before.x).toBeCloseTo(10 * scale, 0);
  expect(nudged.y - before.y).toBeCloseTo(1 * scale, 0);
  await win.keyboard.press('Alt+ArrowLeft');
  expect((await at()).width).toBeCloseTo(nudged.width - scale, 0);

  // Text boxes get a choice of text size.
  await tool(win, 'Text box').click();
  await toolbar(win).getByLabel('Text size').selectOption('18');
  await clickPage(win, 0.1, 0.45);
  await panel(win).getByLabel('Text', { exact: true }).fill('Big words');
  await expect(panel(win).getByLabel('Text size')).toHaveValue('18');
  const target = await save(run, 'moved.pdf');
  const saved = await readPage1(read(target));
  const box = saved.find((a) => a.subtype === 'FreeText');
  expect(box?.data.defaultAppearanceData).toMatchObject({ fontSize: 18 });
  // The stamp was saved where it was left: moved right and down from where it was placed.
  const savedStamp = saved.find((a) => a.subtype === 'Stamp') as Read;
  const pageBox = (await page1(win).boundingBox())!;
  expect(savedStamp.rect[0]).toBeCloseTo((nudged.x - pageBox.x) / scale, -0.5);
});

test('the comments panel lists every annotation; changes and replies to the file’s own are saved', async ({}, info) => {
  // A file someone else commented on (it also has links.pdf's own note, with a reply on page 5).
  const box = (x: number, top: number, w: number, h: number): Quad => [x, top, x + w, top, x, top - h, x + w, top - h];
  const theirs = { source: 'a', createdAt: '2026-10-01T09:00:00.000Z', author: 'Alex Doe' };
  const list: AnnotationInput[] = [
    { ...theirs, id: 'h', index: 0, kind: 'highlight', quads: [box(54, 754, 120, 14)], colour: [1, 0.894, 0.361], comment: 'Please check this name' },
    { ...theirs, id: 's', index: 0, kind: 'stamp', stamp: 'draft', label: 'Draft', date: 'STAMP-TO-DELETE', box: box(380, 700, 150, 50), colour: [0.11, 0.357, 0.69], rotation: 0 },
    { ...theirs, author: 'Sam Lee', id: 'r', index: 0, kind: 'reply', replyTo: 'h', comment: 'Looks fine to me' },
  ];
  const { bytes } = await buildPdf([{ id: 'a', name: 'links.pdf', bytes: fixture('links.pdf') }], [1, 2, 3, 4, 5, 6].map((n) => ({ kind: 'page', source: 'a', index: n - 1, rotate: 0 })), list);
  const file = path.join(outDir(), 'reviewed.pdf');
  writeFileSync(file, bytes);

  const run = (current = await launch(info.project.name));
  const { app, win } = run;
  await setAuthor(win, AUTHOR);
  await chooseInOpenDialog(app, file);
  await goTo(win, 'Start');
  await win.getByRole('button', { name: 'Open a PDF…' }).click();
  await waitForFirstPage(win);

  // The panel lists the file's annotations by page, with who made them and their replies.
  await tool(win, 'Comments').click();
  await expect(comments(win).getByTestId('comments-count')).toHaveText('3 annotations');
  const highlightEntry = comments(win).locator('.sf-comment', { hasText: 'Please check this name' });
  await expect(highlightEntry).toContainText('Highlight');
  await expect(highlightEntry).toContainText('Alex Doe');
  await expect(highlightEntry).toContainText('1 reply');
  await comments(win).getByLabel('Who').selectOption('Alex Doe');
  await expect(comments(win).getByTestId('comments-count')).toHaveText('2 of 3 annotations');
  await comments(win).getByLabel('Kind').selectOption('Stamp');
  await expect(comments(win).locator('.sf-comment')).toHaveCount(1);
  await comments(win).getByLabel('Kind').selectOption('');
  await comments(win).getByLabel('Who').selectOption('');

  // Click one to go to it: its details show, with its reply.
  await highlightEntry.click();
  await expect(panel(win)).toContainText('Highlight on page 1');
  await expect(panel(win).getByTestId('annot-origin')).toContainText('Already in the file, by Alex Doe');
  await expect(panel(win).locator('.sf-reply')).toContainText('Looks fine to me');
  await panel(win).getByRole('radio', { name: 'Blue' }).click();
  await panel(win).getByLabel('Comment').fill('Please check this name again');
  await panel(win).getByRole('button', { name: 'Reply' }).click();
  await panel(win).getByPlaceholder('Type your reply').fill('Done, it is right');
  await expect(highlightEntry).toContainText('not saved yet');
  await expect(highlightEntry).toContainText('2 replies');
  await win.screenshot({ path: path.join(SCREENS, `comments-${info.project.name}.png`) });

  // Delete the stamp.
  await comments(win).locator('.sf-comment', { hasText: 'Stamp' }).click();
  await panel(win).getByRole('button', { name: 'Delete' }).click();
  await expect(comments(win).getByTestId('comments-count')).toHaveText('2 annotations');

  const target = await save(run, 'answered.pdf');
  await expect(win.getByTestId('message')).toContainText('annotation already in the file was changed');
  await expect(win.getByTestId('message')).toContainText('1 annotation was deleted');
  const saved = await readPage1(read(target));
  const highlight = saved.find((a) => a.subtype === 'Highlight') as Read;
  expect(highlight).toMatchObject({ author: 'Alex Doe', contents: 'Please check this name again', colour: [156, 203, 255] });
  expect(saved.find((a) => a.contents === 'Looks fine to me')?.inReplyTo).toBe(highlight.id);
  expect(saved.find((a) => a.contents === 'Done, it is right')).toMatchObject({ author: AUTHOR, inReplyTo: highlight.id });
  expect(saved.some((a) => a.subtype === 'Stamp')).toBe(false);
  expect(await findEverywhere(read(target), 'STAMP-TO-DELETE')).toEqual([]);
  expect(await blockedRequests(app)).toEqual([]);
});

test('burning annotations into the page: the chosen ones, or all of them', async ({}, info) => {
  const run = (current = await launch(info.project.name));
  const { win } = run;
  await setAuthor(win, AUTHOR);
  await open(run, 'links.pdf');
  await tool(win, 'Highlight').click();
  await selectText(win, 'UNIQUE-PAGE-1');
  await tool(win, 'Select').click();
  await win.locator('.sf-annot-highlight .sf-annot-part').first().click();
  await panel(win).getByLabel('Burn into the page when saving').check();
  await panel(win).getByRole('button', { name: 'Done' }).click();
  await tool(win, 'Note').click();
  await clickPage(win, 0.7, 0.2);
  await panel(win).getByLabel('Comment').fill('Stays a note');
  await panel(win).getByRole('button', { name: 'Done' }).click();
  const one = await save(run, 'one-burned.pdf');
  await expect(win.getByTestId('message')).toContainText('1 annotation was burned into the pages.');
  const kept = (await readPage1(read(one))).filter((a) => a.author === AUTHOR);
  expect(kept.map((a) => [a.subtype, a.contents])).toEqual([['Text', 'Stays a note']]);

  // Burn everything: the note made here and the note that came with the file. Links stay.
  await open(run, 'links.pdf');
  await tool(win, 'Comments').click();
  await comments(win).getByLabel('When saving, burn all annotations into the pages').check();
  const all = await save(run, 'all-burned.pdf');
  await expect(win.getByTestId('message')).toContainText('burned into the pages');
  const left = await readPage1(read(all));
  expect(left.filter((a) => a.subtype !== 'Link')).toEqual([]);
  expect(left.filter((a) => a.subtype === 'Link').length).toBeGreaterThan(0);
});
