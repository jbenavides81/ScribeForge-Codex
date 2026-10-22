// RESEARCH (stop 2c): can ScribeForge remove just what's under a redaction mark from a page's own
// drawing instructions, instead of making the whole page a picture? Each case below makes a page
// with something secret on it, marks the secret, runs the prototype (research/text-removal), and
// checks: the secret is found nowhere in the file; the text around it is still real text; nothing
// outside the mark looks any different; and the mark is black. Cases the prototype can't handle
// must be reported, never silently passed. The results are written up in
// docs/Research_TextRemoval.md.
import { createCanvas } from '@napi-rs/canvas';
import { decodePDFRawStream, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFStream, StandardFonts, type PDFFont, type PDFPage, type PDFRef } from '@cantoo/pdf-lib';
import { deflateSync } from 'node:zlib';
import path from 'node:path';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import { removeUnderMarks, type RemovalResult } from '../../research/text-removal/remove';
import { sweepUnreachable } from '../../src/engine/objects';
import { findEverywhere, pageTexts, ROOT } from './support/inspect';

type Rect = [number, number, number, number];
const FONTS = `${path.join(ROOT, 'node_modules/pdfjs-dist/standard_fonts').replace(/\\/g, '/')}/`;
const SIZE = 12;

/** A page drawn as pixels (1.5 pixels to a point). */
async function render(bytes: Uint8Array, n: number) {
  const doc = await pdfjs.getDocument({ data: bytes.slice(), standardFontDataUrl: FONTS, useWorkerFetch: false, verbosity: 0 }).promise;
  const page = await doc.getPage(n);
  const viewport = page.getViewport({ scale: 1.5 });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas: canvas as unknown as HTMLCanvasElement, canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport }).promise;
  await doc.loadingTask.destroy();
  return { data: ctx.getImageData(0, 0, canvas.width, canvas.height).data, width: canvas.width, height: canvas.height };
}

/** Pixels that differ outside the marks (with 2 points around each for smoothed edges), and whether each mark's middle is black. */
async function compare(before: Uint8Array, after: Uint8Array, n: number, marks: Rect[]) {
  const a = await render(before, n);
  const b = await render(after, n);
  const pageHeight = a.height / 1.5;
  let outside = 0;
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      const [px, py] = [x / 1.5, pageHeight - y / 1.5];
      if (marks.some((m) => px > m[0] - 2 && px < m[2] + 2 && py > m[1] - 2 && py < m[3] + 2)) continue;
      const i = (y * a.width + x) * 4;
      if (a.data[i] !== b.data[i] || a.data[i + 1] !== b.data[i + 1] || a.data[i + 2] !== b.data[i + 2]) outside++;
    }
  }
  const black = marks.every((m) => {
    const i = (Math.round((pageHeight - (m[1] + m[3]) / 2) * 1.5) * b.width + Math.round(((m[0] + m[2]) / 2) * 1.5)) * 4;
    return b.data[i] < 10 && b.data[i + 1] < 10 && b.data[i + 2] < 10;
  });
  return { outside, black };
}

/** A new document with Helvetica, and a way to add raw drawing instructions to a page. */
async function start() {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  const F = page.node.newFontDictionary('F', font.ref).decodeText();
  const draw = (p: PDFPage, text: string) => p.node.addContentStream(doc.context.register(doc.context.flateStream(text)));
  return { doc, font, page, F, draw };
}

/**
 * How wide text is drawn: each letter's own width. (pdf-lib's widthOfTextAtSize also tucks letter
 * pairs closer together, as a typesetter would, but a PDF reader drawing plain text doesn't.)
 */
const textWidth = (font: PDFFont, text: string, size = SIZE) => [...text].reduce((w, ch) => w + font.widthOfTextAtSize(ch, size), 0);

/** The box around `term`, written at x, y after `before`, shrunk a little so it doesn't touch its neighbours. */
function markFor(font: PDFFont, x: number, y: number, before: string, term: string, size = SIZE, extra = 0): Rect {
  const x0 = x + textWidth(font, before, size);
  const x1 = x0 + textWidth(font, term, size) + extra;
  return [x0 + 0.5, y - 0.207 * size, x1 - 0.5, y + 0.718 * size];
}

const lit = (s: string) => `(${s.replace(/[()\\]/g, (c) => `\\${c}`)})`;

interface Case {
  bytes: Uint8Array;
  after: Uint8Array;
  result: RemovalResult;
  marks: Rect[];
}

async function run(doc: PDFDocument, pageIndex: number, marks: Rect[]): Promise<Case> {
  const bytes = await doc.save({ useObjectStreams: false });
  const copy = await PDFDocument.load(bytes, { updateMetadata: false });
  const result = removeUnderMarks(copy, pageIndex, marks);
  // What's left unused (such as the page's old drawing instructions) goes, as the app's engine does before saving.
  sweepUnreachable(copy);
  return { bytes, after: await copy.save({ useObjectStreams: false }), result, marks };
}

/** The four checks for a case the prototype handles. */
async function passes(c: Case, secrets: string[], kept: string[], page = 1) {
  expect(c.result.unsupported).toEqual([]);
  for (const s of secrets) expect(await findEverywhere(c.after, s), s).toEqual([]);
  const text = (await pageTexts(c.after))[page - 1];
  for (const k of kept) expect(text, k).toContain(k);
  const { outside, black } = await compare(c.bytes, c.after, page, c.marks);
  expect(outside, 'pixels changed outside the marks').toBe(0);
  expect(black, 'marks are black').toBe(true);
}

describe('removing just what is under a mark (research prototype)', () => {
  it('text in a sentence', async () => {
    const { doc, font, page, F, draw } = await start();
    draw(page, `BT /${F} ${SIZE} Tf 54 700 Td ${lit('The secret is SECRET-NAME in this sentence.')} Tj ET`);
    const c = await run(doc, 0, [markFor(font, 54, 700, 'The secret is ', 'SECRET-NAME')]);
    expect(c.result.glyphs).toBe('SECRET-NAME'.length);
    await passes(c, ['SECRET-NAME', 'SECRET'], ['The secret is', 'in this sentence.']);
  });

  it('text split up and kerned (TJ), with letter, word and width spacing', async () => {
    const { doc, font, page, F, draw } = await start();
    draw(page, `BT /${F} ${SIZE} Tf 54 700 Td [${lit('The code ')} ${lit('SECR')} -40 ${lit('ET-KERNED')} ${lit(' is here.')}] TJ ET`);
    draw(page, `BT /${F} ${SIZE} Tf 1 Tc 4 Tw 80 Tz 54 650 Td ${lit('Wide SPACED-SECRET words')} Tj ET`);
    const kerned = markFor(font, 54, 700, 'The code ', 'SECRET-KERNED', SIZE, 0.48);
    // With spacing: each letter is 1 point further apart, spaces 4 more, all at 80% width.
    const sx0 = 54 + (textWidth(font, 'Wide ') + 5 * 1 + 4) * 0.8;
    const sx1 = sx0 + (textWidth(font, 'SPACED-SECRET') + 13 * 1) * 0.8;
    const spaced: Rect = [sx0 + 0.5, 650 - 2.5, sx1 - 1.5, 650 + 8.6];
    const c = await run(doc, 0, [kerned, spaced]);
    await passes(c, ['SECR', 'ET-KERNED', 'SPACED-SECRET'], ['The code', 'is here.', 'Wide', 'words']);
  });

  it('invisible text (as in scanned documents) and text on a hidden layer', async () => {
    const { doc, font, page, F, draw } = await start();
    const layer = doc.context.register(doc.context.obj({ Type: 'OCG', Name: 'Hidden notes' }));
    doc.catalog.set(PDFName.of('OCProperties'), doc.context.obj({ OCGs: [layer], D: { OFF: [layer] } }));
    page.node.Resources()?.set(PDFName.of('Properties'), doc.context.obj({ L1: layer }));
    draw(page, `BT /${F} ${SIZE} Tf 54 700 Td ${lit('Visible words')} Tj ET`);
    draw(page, `BT 3 Tr /${F} ${SIZE} Tf 54 660 Td ${lit('Scanned INVISIBLE-SECRET text')} Tj ET`);
    draw(page, `/OC /L1 BDC BT /${F} ${SIZE} Tf 54 620 Td ${lit('Draft LAYER-SECRET note')} Tj ET EMC`);
    const c = await run(doc, 0, [markFor(font, 54, 660, 'Scanned ', 'INVISIBLE-SECRET'), markFor(font, 54, 620, 'Draft ', 'LAYER-SECRET')]);
    await passes(c, ['INVISIBLE-SECRET', 'LAYER-SECRET'], ['Visible words', 'Scanned', 'text']);
  });

  it('text with ActualText kept for screen readers', async () => {
    const { doc, font, page, F, draw } = await start();
    draw(page, `/Span <</ActualText ${lit('ALT-SECRET')}>> BDC BT /${F} ${SIZE} Tf 54 700 Td ${lit('Name: ALT-SECRET')} Tj ET EMC`);
    const c = await run(doc, 0, [markFor(font, 54, 700, 'Name: ', 'ALT-SECRET')]);
    await passes(c, ['ALT-SECRET'], ['Name:']);
  });

  it('text turned sideways', async () => {
    const { doc, font, page, F, draw } = await start();
    draw(page, `BT /${F} ${SIZE} Tf 0 1 -1 0 300 200 Tm ${lit('Up ROTATED-SECRET here')} Tj ET`);
    const y0 = 200 + textWidth(font, 'Up ');
    const y1 = y0 + textWidth(font, 'ROTATED-SECRET');
    const c = await run(doc, 0, [[300 - 0.718 * SIZE, y0 + 0.5, 300 + 0.207 * SIZE, y1 - 0.5]]);
    await passes(c, ['ROTATED-SECRET'], ['Up', 'here']);
  });

  it('a font that lists its own widths', async () => {
    const { doc, font, page, draw } = await start();
    const widths = Array.from({ length: 95 }, (_, i) => Math.round(font.widthOfTextAtSize(String.fromCharCode(32 + i), 1000)));
    const listed = doc.context.register(doc.context.obj({ Type: 'Font', Subtype: 'TrueType', BaseFont: 'Helvetica', FirstChar: 32, LastChar: 126, Widths: widths, Encoding: 'WinAnsiEncoding' }));
    const W = page.node.newFontDictionary('W', listed).decodeText();
    draw(page, `BT /${W} ${SIZE} Tf 54 700 Td ${lit('Listed WIDTHS-SECRET font')} Tj ET`);
    const c = await run(doc, 0, [markFor(font, 54, 700, 'Listed ', 'WIDTHS-SECRET')]);
    await passes(c, ['WIDTHS-SECRET'], ['Listed', 'font']);
  });

  it('text inside a drawing shared by two pages: only the marked page changes', async () => {
    const { doc, font, page, F, draw } = await start();
    const form = doc.context.formXObject([], { BBox: [0, 0, 400, 40], Resources: { Font: { [F]: font.ref } } });
    form.dict.delete(PDFName.of('Length'));
    const formStream = doc.context.flateStream(`BT /${F} ${SIZE} Tf 0 10 Td ${lit('Header with FORM-SECRET inside')} Tj ET`, { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 400, 40], Resources: { Font: { [F]: font.ref } } });
    const ref = doc.context.register(formStream);
    const second = doc.addPage([612, 792]);
    for (const p of [page, second]) {
      const X = p.node.newXObject('X', ref).decodeText();
      draw(p, `q 1 0 0 1 54 690 cm /${X} Do Q`);
    }
    const c = await run(doc, 0, [markFor(font, 54, 700, 'Header with ', 'FORM-SECRET')]);
    expect(c.result.unsupported).toEqual([]);
    const texts = await pageTexts(c.after);
    expect(texts[0]).not.toContain('FORM-SECRET');
    expect(texts[0]).toContain('Header with');
    expect(texts[1]).toContain('Header with FORM-SECRET inside');
    const { outside, black } = await compare(c.bytes, c.after, 1, c.marks);
    expect(outside).toBe(0);
    expect(black).toBe(true);
  });

  it('a Type 3 font (letters drawn by small drawings of their own)', async () => {
    const { doc, page, draw } = await start();
    const square = doc.context.register(doc.context.flateStream('600 0 0 0 600 700 d1 0 0 600 700 re f'));
    const bar = doc.context.register(doc.context.flateStream('600 0 0 0 600 700 d1 0 300 600 100 re f'));
    const t3 = doc.context.register(
      doc.context.obj({
        Type: 'Font',
        Subtype: 'Type3',
        FontBBox: [0, 0, 600, 700],
        FontMatrix: [0.001, 0, 0, 0.001, 0, 0],
        CharProcs: { square, bar },
        Encoding: { Type: 'Encoding', Differences: [97, PDFName.of('square'), PDFName.of('bar')] },
        FirstChar: 97,
        LastChar: 98,
        Widths: [700, 700],
        Resources: {},
      }),
    );
    const T = page.node.newFontDictionary('T', t3).decodeText();
    draw(page, `BT /${T} 20 Tf 54 700 Td (aabbaa) Tj ET`);
    // The two "bar" letters in the middle: each 0.7 × 20 = 14 points wide.
    const mark: Rect = [54 + 28 + 0.5, 699, 54 + 56 - 0.5, 715];
    const c = await run(doc, 0, [mark]);
    expect(c.result).toMatchObject({ glyphs: 2, unsupported: [] });
    const { outside, black } = await compare(c.bytes, c.after, 1, c.marks);
    expect(outside).toBe(0);
    expect(black).toBe(true);
  });

  it('a picture stored with Flate: the marked part of the picture itself is blacked out', async () => {
    const { doc, page, draw } = await start();
    const w = 40;
    const pixels = new Uint8Array(w * w * 3);
    for (let i = 0; i < w * w; i++) pixels.set([230, 40, 40], i * 3);
    const image = doc.context.register(doc.context.stream(deflateSync(pixels), { Type: 'XObject', Subtype: 'Image', Width: w, Height: w, ColorSpace: 'DeviceRGB', BitsPerComponent: 8, Filter: 'FlateDecode' }));
    const X = page.node.newXObject('Im', image).decodeText();
    draw(page, `q 200 0 0 200 100 400 cm /${X} Do Q`);
    // The left half of the picture.
    const c = await run(doc, 0, [[100, 400, 200, 600]]);
    expect(c.result).toMatchObject({ images: 1, unsupported: [] });
    const { outside, black } = await compare(c.bytes, c.after, 1, c.marks);
    expect(outside).toBe(0);
    expect(black).toBe(true);
    // Under the black box, the picture's own pixels are black now, not just covered.
    const copy = await PDFDocument.load(c.after);
    const xobjects = copy.getPage(0).node.Resources()?.lookup(PDFName.of('XObject'), PDFDict);
    const blacked = copy.context.lookup(xobjects?.get(PDFName.of(X)) as PDFRef, PDFStream) as PDFRawStream;
    const px = decodePDFRawStream(blacked).decode();
    const at = (x: number, y: number) => [...px.subarray((y * w + x) * 3, (y * w + x) * 3 + 3)];
    expect(at(5, 20)).toEqual([0, 0, 0]);
    expect(at(35, 20)).toEqual([230, 40, 40]);
  });

  it('a JPEG picture under a mark is reported, not removed', async () => {
    const { doc, page } = await start();
    const canvas = createCanvas(40, 40);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#3366cc';
    ctx.fillRect(0, 0, 40, 40);
    const jpeg = await doc.embedJpg(canvas.encodeSync('jpeg'));
    page.drawImage(jpeg, { x: 100, y: 400, width: 200, height: 200 });
    const c = await run(doc, 0, [[100, 400, 200, 600]]);
    expect(c.result.unsupported).toEqual(['a picture stored as JPEG']);
  });

  it('drawings: one wholly inside a mark is removed; one crossing its edge is reported', async () => {
    const { doc, page, draw } = await start();
    draw(page, '0 0 1 rg 110 410 50 50 re f');
    const inside = await run(doc, 0, [[100, 400, 200, 500]]);
    expect(inside.result).toMatchObject({ drawings: 1, unsupported: [] });
    const { outside } = await compare(inside.bytes, inside.after, 1, inside.marks);
    expect(outside).toBe(0);
    draw(page, '1 0 0 RG 4 w 50 450 m 300 450 l S');
    const crossing = await run(doc, 0, [[100, 400, 200, 500]]);
    expect(crossing.result.unsupported).toEqual(['a drawing that crosses the edge of a mark']);
  });

  it('keeps the page as real text: the rest can still be found and copied, and the file stays small', async () => {
    const { doc, font, page, F, draw } = await start();
    const lines = Array.from({ length: 30 }, (_, i) => `Line ${i + 1} of the report, mentioning ${i === 10 ? 'MARKED-SECRET' : 'nothing secret'} at all.`);
    draw(page, lines.map((l, i) => `BT /${F} 10 Tf 54 ${740 - i * 20} Td ${lit(l)} Tj ET`).join('\n'));
    const c = await run(doc, 0, [markFor(font, 54, 540, 'Line 11 of the report, mentioning ', 'MARKED-SECRET', 10)]);
    await passes(c, ['MARKED-SECRET'], ['Line 1 of the report', 'Line 30 of the report', 'nothing secret']);
    // A page made into a picture at 200 dpi is typically 300 KB or more; this one stays a few KB.
    expect(c.after.length).toBeLessThan(c.bytes.length + 8000);
  });
});
