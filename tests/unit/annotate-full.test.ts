// Stop 2b's required checks for the engine: every new kind of annotation reads back through pdf.js
// (standing in for any reader) with its type, colour, author, text and position; changes to
// annotations already in a file are saved, and deleted ones are gone from the file; replies point
// at the right comment; and burned-in (flattened) pages look the same, pixel for pixel.
import { createCanvas } from '@napi-rs/canvas';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFString } from '@cantoo/pdf-lib';
import path from 'node:path';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import { buildPdf } from '../../src/engine/build';
import { placementMatrix } from '../../src/engine/flatten';
import type { AnnotationInput, FileAnnotationChange, PageItem, Quad, SourceInput } from '../../src/engine/types';
import { findEverywhere, fixture, ROOT, strayPages } from './support/inspect';

const FONTS = `${path.join(ROOT, 'node_modules/pdfjs-dist/standard_fonts').replace(/\\/g, '/')}/`;
const box = (x: number, top: number, w: number, h: number): Quad => [x, top, x + w, top, x, top - h, x + w, top - h];
const base = { source: 'a', createdAt: '2026-10-21T12:00:00.000Z', author: 'Pat Tester' };
const links = (): SourceInput => ({ id: 'a', name: 'links.pdf', bytes: fixture('links.pdf') });
const pages = (list: number[], source = 'a'): PageItem[] => list.map((n) => ({ kind: 'page', source, index: n - 1, rotate: 0 }));
const red: [number, number, number] = [0.718, 0.11, 0.11];
const blue: [number, number, number] = [0.11, 0.357, 0.69];
const green: [number, number, number] = [0.118, 0.42, 0.188];
const yellow: [number, number, number] = [1, 0.894, 0.361];

type Read = { id: string; page: number; subtype: string; contents: string; author: string; colour: number[]; rect: number[]; inReplyTo?: string; data: Record<string, unknown> };

/** Every annotation as pdf.js reads it (links too). */
async function readAll(bytes: Uint8Array): Promise<Read[]> {
  const doc = await pdfjs.getDocument({ data: bytes.slice(), standardFontDataUrl: FONTS, useWorkerFetch: false, verbosity: 0 }).promise;
  const out: Read[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    for (const a of await (await doc.getPage(i)).getAnnotations()) {
      out.push({
        id: a.id,
        page: i,
        subtype: a.subtype,
        contents: a.contentsObj?.str ?? '',
        author: a.titleObj?.str ?? '',
        colour: a.color ? [...a.color] : [],
        rect: [...a.rect],
        inReplyTo: a.inReplyTo ?? undefined,
        data: a,
      });
    }
  }
  await doc.loadingTask.destroy();
  return out;
}

const to255 = (c: number[]) => c.map((v) => Math.round(v * 255));

/** A page drawn as pixels, with or without its annotations' looks. */
async function pixels(bytes: Uint8Array, n: number, withAnnotations: boolean): Promise<{ data: Uint8ClampedArray; width: number; height: number }> {
  const doc = await pdfjs.getDocument({ data: bytes.slice(), standardFontDataUrl: FONTS, useWorkerFetch: false, verbosity: 0 }).promise;
  const page = await doc.getPage(n);
  const viewport = page.getViewport({ scale: 1.5 });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  const annotationMode = withAnnotations ? pdfjs.AnnotationMode.ENABLE : pdfjs.AnnotationMode.DISABLE;
  await page.render({ canvas: canvas as unknown as HTMLCanvasElement, canvasContext: context as unknown as CanvasRenderingContext2D, viewport, annotationMode }).promise;
  await doc.loadingTask.destroy();
  return { data: context.getImageData(0, 0, canvas.width, canvas.height).data, width: canvas.width, height: canvas.height };
}

/** How many pixels differ, and by how much at most (0 to 255). */
function differences(a: Uint8ClampedArray, b: Uint8ClampedArray): { count: number; largest: number } {
  let count = 0;
  let largest = 0;
  for (let i = 0; i < a.length; i += 4) {
    const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
    if (d > 0) count++;
    largest = Math.max(largest, d);
  }
  return { count, largest };
}
const differing = (a: Uint8ClampedArray, b: Uint8ClampedArray) => differences(a, b).count;

/** The raw dictionary of a saved annotation, found by its name (scribeforge-<id>). */
async function rawAnnotation(bytes: Uint8Array, id: string): Promise<PDFDict | undefined> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  for (const page of doc.getPages()) {
    for (const ref of page.node.lookupMaybe(PDFName.of('Annots'), PDFArray)?.asArray() ?? []) {
      const dict = doc.context.lookup(ref);
      if (dict instanceof PDFDict && dict.lookupMaybe(PDFName.of('NM'), PDFString)?.decodeText() === `scribeforge-${id}`) return dict;
    }
  }
  return undefined;
}

function newKinds(): AnnotationInput[] {
  return [
    { ...base, id: 'ink1', index: 0, kind: 'ink', paths: [[[100, 100], [150, 140], [200, 100]], [[100, 90], [200, 90]]], colour: red, width: 2, comment: 'A signature-like scribble' },
    { ...base, id: 'rect1', index: 0, kind: 'rect', box: box(100, 400, 100, 50), colour: blue, fill: yellow, width: 2, comment: 'Boxed' },
    { ...base, id: 'oval1', index: 0, kind: 'ellipse', box: box(250, 400, 120, 60), colour: green, width: 4 },
    { ...base, id: 'line1', index: 0, kind: 'line', from: [100, 300], to: [250, 300], colour: red, width: 1 },
    { ...base, id: 'arrow1', index: 0, kind: 'arrow', from: [300, 300], to: [400, 350], colour: blue, width: 3, comment: 'Look here' },
    { ...base, id: 'stamp1', index: 0, kind: 'stamp', stamp: 'approved', label: 'Approved', date: 'October 21, 2026', box: box(300, 600, 150, 50), colour: green, rotation: 0 },
    { ...base, id: 'stamp2', index: 0, kind: 'stamp', stamp: 'custom', label: 'Paid in full', date: 'October 21, 2026', box: box(100, 600, 150, 50), colour: red, rotation: 0, comment: 'Settled' },
    { ...base, id: 'big1', index: 0, kind: 'text', box: box(100, 500, 200, 30), text: 'Large text', colour: red, fontSize: 18, rotation: 0 },
  ];
}

describe('new kinds of annotation', () => {
  it('read back through pdf.js with their type, colour, author, text and position', async () => {
    const { bytes, report } = await buildPdf([links()], pages([1]), newKinds());
    expect(report.annotationsAdded).toBe(8);
    const read = (await readAll(bytes)).filter((a) => a.author === 'Pat Tester');
    expect(read.map((a) => [a.subtype, a.contents])).toEqual([
      ['Ink', 'A signature-like scribble'],
      ['Square', 'Boxed'],
      ['Circle', ''],
      ['Line', ''],
      ['Line', 'Look here'],
      ['Stamp', 'Approved, October 21, 2026'],
      ['Stamp', 'Settled'],
      ['FreeText', 'Large text'],
    ]);
    expect(read.map((a) => a.colour)).toEqual([red, blue, green, red, blue, green, red, red].map(to255));

    const [inkRead, rectRead, ovalRead, lineRead, arrowRead, stampRead] = read;
    expect((inkRead.data.inkLists as ArrayLike<number>[]).map((l) => Array.from(l))).toEqual([[100, 100, 150, 140, 200, 100], [100, 90, 200, 90]]);
    expect(inkRead.rect).toEqual([98, 88, 202, 142]); // the strokes plus the pen's width
    expect(rectRead.rect).toEqual([100, 350, 200, 400]);
    expect(ovalRead.rect).toEqual([250, 340, 370, 400]);
    expect(Array.from(lineRead.data.lineCoordinates as number[])).toEqual([100, 300, 250, 300]);
    expect(lineRead.data.lineEndings).toEqual(['None', 'None']);
    expect(Array.from(arrowRead.data.lineCoordinates as number[])).toEqual([300, 300, 400, 350]);
    expect(arrowRead.data.lineEndings).toEqual(['None', 'OpenArrow']);
    expect(stampRead.rect).toEqual([300, 550, 450, 600]);

    // What pdf.js doesn't report, read from the file itself.
    expect((await rawAnnotation(bytes, 'rect1'))?.get(PDFName.of('IC'))?.toString()).toBe('[ 1 0.894 0.361 ]');
    expect((await rawAnnotation(bytes, 'oval1'))?.get(PDFName.of('IC'))).toBeUndefined();
    expect((await rawAnnotation(bytes, 'oval1'))?.lookup(PDFName.of('BS'), PDFDict).get(PDFName.of('W'))?.toString()).toBe('4');
    expect((await rawAnnotation(bytes, 'stamp1'))?.get(PDFName.of('Name'))?.toString()).toBe('/Approved');
    expect((await rawAnnotation(bytes, 'big1'))?.lookup(PDFName.of('DA'), PDFString).decodeText()).toMatch(/^\/Helv 18 Tf/);
    // Every one has its own look, so every reader draws the same thing.
    for (const a of read) expect(a.data.hasAppearance, a.subtype).toBe(true);
  });

  it('each has a look that matches where it is: the drawing shows on the page', async () => {
    const { bytes } = await buildPdf([links()], pages([1]), newKinds());
    const plain = await pixels(bytes, 1, false);
    const drawn = await pixels(bytes, 1, true);
    expect(differing(plain.data, drawn.data)).toBeGreaterThan(5000);
  });
});

describe('replies', () => {
  it('point at the comment they answer, new or already in the file', async () => {
    // The note that came with links.pdf (made by another program), by pdf.js's id for it.
    const oldNote = (await readAll(links().bytes)).find((a) => a.contents === 'NOTE-ON-PAGE-1') as Read;
    const list: AnnotationInput[] = [
      { ...base, id: 'h1', index: 0, kind: 'highlight', quads: [box(54, 754, 120, 14)], colour: yellow, comment: 'Check this' },
      { ...base, id: 'r1', index: 0, kind: 'reply', replyTo: 'h1', comment: 'Checked, it is right' },
      { ...base, id: 'r2', index: 0, kind: 'reply', replyTo: 'r1', comment: 'Thanks' },
      { ...base, id: 'r3', index: 0, kind: 'reply', replyTo: `file:${oldNote.id}`, comment: 'Answering the old note' },
    ];
    const { bytes, report } = await buildPdf([links()], pages([1]), list);
    expect(report.annotationsAdded).toBe(4);
    const read = await readAll(bytes);
    const byContents = (text: string) => read.find((a) => a.contents === text) as Read;
    expect(byContents('Checked, it is right').inReplyTo).toBe(byContents('Check this').id);
    expect(byContents('Thanks').inReplyTo).toBe(byContents('Checked, it is right').id);
    expect(byContents('Answering the old note').inReplyTo).toBe(byContents('NOTE-ON-PAGE-1').id);
    for (const text of ['Checked, it is right', 'Thanks', 'Answering the old note']) {
      expect(byContents(text)).toMatchObject({ subtype: 'Text', author: 'Pat Tester' });
      expect(byContents(text).data.replyType).toBe('R');
    }
    // No marks of ScribeForge's own workings are left in the file.
    expect(await findEverywhere(bytes, 'ScribeForgeRef')).toEqual([]);
  });

  it('a reply on another page keeps pointing at its comment when both pages are in the new file', async () => {
    // links.pdf's reply on page 5 answers the note on page 1.
    const both = await readAll((await buildPdf([links()], pages([5, 2, 1]))).bytes);
    const note = both.find((a) => a.contents === 'NOTE-ON-PAGE-1') as Read;
    expect(both.find((a) => a.contents === 'REPLY-ON-PAGE-5')?.inReplyTo).toBe(note.id);
    // Page 5 on its own: the reply is just a note, and page 1's note isn't dragged in.
    const alone = await buildPdf([links()], pages([5]));
    expect((await readAll(alone.bytes)).find((a) => a.contents === 'REPLY-ON-PAGE-5')?.inReplyTo).toBeUndefined();
    expect(await findEverywhere(alone.bytes, 'NOTE-ON-PAGE-1')).toEqual([]);
    expect(await strayPages(alone.bytes)).toBe(0);
  });

  it("are left out when what they answer isn't in the new file", async () => {
    const list: AnnotationInput[] = [
      { ...base, id: 'h1', index: 1, kind: 'highlight', quads: [box(54, 754, 120, 14)], colour: yellow },
      { ...base, id: 'r1', index: 1, kind: 'reply', replyTo: 'h1', comment: 'On page 2' },
    ];
    const { report } = await buildPdf([links()], pages([1]), list);
    expect(report).toMatchObject({ annotationsAdded: 0, annotationsLeftOut: 2 });
  });
});

describe('annotations already in a file', () => {
  /** A file with annotations made earlier (here by ScribeForge; to this build they're the file's own). */
  async function earlier(): Promise<{ source: SourceInput; ids: Record<string, string> }> {
    const list: AnnotationInput[] = [
      { ...base, id: 'h1', index: 0, kind: 'highlight', quads: [box(54, 754, 120, 14)], colour: yellow, comment: 'OLD-COMMENT-TEXT' },
      { ...base, id: 'r1', index: 0, kind: 'reply', replyTo: 'h1', comment: 'An earlier reply' },
      { ...base, id: 'i1', index: 0, kind: 'ink', paths: [[[100, 100], [200, 150]]], colour: red, width: 2 },
      { ...base, id: 's1', index: 0, kind: 'stamp', stamp: 'draft', label: 'Draft', date: 'STAMP-DATE-TEXT', box: box(300, 600, 150, 50), colour: blue, rotation: 0 },
    ];
    const { bytes } = await buildPdf([links()], pages([1, 2]), list);
    const read = await readAll(bytes);
    const id = (pred: (a: Read) => boolean) => (read.find(pred) as Read).id;
    return {
      source: { id: 'e', name: 'earlier.pdf', bytes },
      ids: {
        highlight: id((a) => a.subtype === 'Highlight'),
        reply: id((a) => a.contents === 'An earlier reply'),
        ink: id((a) => a.subtype === 'Ink'),
        stamp: id((a) => a.subtype === 'Stamp'),
        note: id((a) => a.contents === 'NOTE-ON-PAGE-1'),
      },
    };
  }

  it('changes are saved, and what was not changed (author, date, replies) stays', async () => {
    const { source, ids } = await earlier();
    const changes: FileAnnotationChange[] = [
      {
        source: 'e',
        index: 0,
        ref: ids.highlight,
        comment: 'NEW-COMMENT-TEXT',
        redraw: { ...base, source: 'e', id: 'x', index: 0, kind: 'highlight', quads: [box(54, 754, 120, 14)], colour: [0.608, 0.898, 0.561] },
      },
      { source: 'e', index: 0, ref: ids.ink, redraw: { ...base, source: 'e', id: 'y', index: 0, kind: 'ink', paths: [[[100, 100], [200, 150]]], colour: blue, width: 2 } },
      { source: 'e', index: 0, ref: ids.note, comment: 'The old note, reworded' },
    ];
    const before = (await readAll(source.bytes)).find((a) => a.id === ids.highlight) as Read;
    const { bytes, report } = await buildPdf([source], pages([1, 2], 'e'), [], { fileChanges: changes });
    expect(report).toMatchObject({ annotationsChanged: 3, annotationsDeleted: 0 });
    const read = await readAll(bytes);
    const highlight = read.find((a) => a.subtype === 'Highlight') as Read;
    expect(highlight).toMatchObject({ contents: 'NEW-COMMENT-TEXT', author: 'Pat Tester', colour: [155, 229, 143] });
    expect(highlight.data.creationDate).toBe(before.data.creationDate);
    expect(read.find((a) => a.contents === 'An earlier reply')?.inReplyTo).toBe(highlight.id);
    expect(read.find((a) => a.subtype === 'Ink')?.colour).toEqual(to255(blue));
    expect(read.find((a) => a.contents === 'The old note, reworded')?.subtype).toBe('Text');
    // The old comment is gone from the file, not just hidden.
    expect(await findEverywhere(bytes, 'OLD-COMMENT-TEXT')).toEqual([]);
  });

  it('deleted ones are gone from the file, with their replies', async () => {
    const { source, ids } = await earlier();
    const changes: FileAnnotationChange[] = [
      { source: 'e', index: 0, ref: ids.stamp, deleted: true },
      { source: 'e', index: 0, ref: ids.highlight, deleted: true },
    ];
    const { bytes, report } = await buildPdf([source], pages([1, 2], 'e'), [], { fileChanges: changes });
    expect(report.annotationsDeleted).toBe(2);
    const subtypes = (await readAll(bytes)).map((a) => a.subtype);
    expect(subtypes).not.toContain('Stamp');
    expect(subtypes).not.toContain('Highlight');
    for (const text of ['STAMP-DATE-TEXT', 'OLD-COMMENT-TEXT', 'An earlier reply']) expect(await findEverywhere(bytes, text)).toEqual([]);
    // Everything else stays: the ink, the old note and the links.
    expect(subtypes.filter((s) => s === 'Ink' || s === 'Text' || s === 'Link').length).toBeGreaterThanOrEqual(3);
    // The original file wasn't touched.
    expect((await readAll(source.bytes)).some((a) => a.subtype === 'Stamp')).toBe(true);
  });

  it('a change for an annotation that isn’t on the page named is ignored', async () => {
    const { source, ids } = await earlier();
    const { report } = await buildPdf([source], pages([1, 2], 'e'), [], { fileChanges: [{ source: 'e', index: 1, ref: ids.stamp, deleted: true }] });
    expect(report.annotationsDeleted).toBe(0);
  });
});

describe('burning annotations into the page (flattening)', () => {
  it('the page looks the same, pixel for pixel, and no burned-in annotation is left', async () => {
    const all = [...newKinds(), { ...base, id: 'u1', index: 0, kind: 'underline', quads: [box(54, 736, 200, 14)], colour: red } as AnnotationInput];
    const kept = await buildPdf([links()], pages([1]), all);
    const burned = await buildPdf([links()], pages([1]), all.map((a) => ({ ...a, flatten: true })));
    expect(burned.report).toMatchObject({ annotationsFlattened: 9, annotationsNotFlattened: 0 });
    expect(differences((await pixels(kept.bytes, 1, true)).data, (await pixels(burned.bytes, 1, true)).data)).toEqual({ count: 0, largest: 0 });
    const left = (await readAll(burned.bytes)).filter((a) => a.author === 'Pat Tester');
    expect(left).toEqual([]);
    expect(await findEverywhere(burned.bytes, 'ScribeForgeFlatten')).toEqual([]);
  });

  it('a burned-in highlight looks the same, within pdf.js’s rounding', async () => {
    // A page whose own drawing blends colours (as a highlight does, so the text under it stays
    // dark) is drawn by pdf.js on a see-through layer first, which rounds smoothed edges a
    // little differently: at most 1 in 255, and only at edges.
    const list: AnnotationInput[] = [
      { ...base, id: 'h1', index: 0, kind: 'highlight', quads: [box(54, 754, 120, 14)], colour: yellow },
      { ...base, id: 'u1', index: 0, kind: 'underline', quads: [box(54, 736, 200, 14)], colour: red },
      { ...base, id: 's1', index: 0, kind: 'stamp', stamp: 'draft', label: 'Draft', date: 'October 21, 2026', box: box(300, 600, 150, 50), colour: blue, rotation: 0 },
    ];
    const kept = await buildPdf([links()], pages([1]), list);
    const burned = await buildPdf([links()], pages([1]), list.map((a) => ({ ...a, flatten: true })));
    const page = await pixels(kept.bytes, 1, true);
    const diff = differences(page.data, (await pixels(burned.bytes, 1, true)).data);
    expect(diff.largest).toBeLessThanOrEqual(1);
    expect(diff.count).toBeLessThan(page.width * page.height * 0.001);
  });

  it('on a page turned sideways too', async () => {
    // links.pdf's page 2 is turned a quarter in its file.
    const turned: AnnotationInput[] = [
      { ...base, id: 't1', index: 1, kind: 'text', box: [300, 100, 300, 300, 270, 100, 270, 300], text: 'Sideways text', colour: red, fontSize: 12, rotation: 90 },
      { ...base, id: 's1', index: 1, kind: 'stamp', stamp: 'reviewed', label: 'Reviewed', date: 'October 21, 2026', box: [200, 100, 200, 250, 150, 100, 150, 250], colour: blue, rotation: 90 },
    ];
    const kept = await buildPdf([links()], pages([2]), turned);
    const burned = await buildPdf([links()], pages([2]), turned.map((a) => ({ ...a, flatten: true })));
    // Drawn in exactly the same place (see the placement test below); pdf.js smooths the edges
    // of letters turned sideways a little differently when they're part of the page.
    const page = await pixels(kept.bytes, 1, true);
    const diff = differences(page.data, (await pixels(burned.bytes, 1, true)).data);
    expect(diff.largest).toBeLessThanOrEqual(8);
    expect(diff.count).toBeLessThan(page.width * page.height * 0.001);
    // Lines and shapes on a sideways page come out exact.
    const ink: AnnotationInput[] = [{ ...base, id: 'i1', index: 1, kind: 'ink', paths: [[[100, 100], [150, 140], [180, 90]]], colour: red, width: 3 }];
    const inkKept = await buildPdf([links()], pages([2]), ink);
    const inkBurned = await buildPdf([links()], pages([2]), ink.map((a) => ({ ...a, flatten: true })));
    expect(differences((await pixels(inkKept.bytes, 1, true)).data, (await pixels(inkBurned.bytes, 1, true)).data)).toEqual({ count: 0, largest: 0 });
  });

  it('only the ones chosen, and their replies go with them', async () => {
    const list: AnnotationInput[] = [
      { ...base, id: 'h1', index: 0, kind: 'highlight', quads: [box(54, 754, 120, 14)], colour: yellow, comment: 'Burned', flatten: true },
      { ...base, id: 'r1', index: 0, kind: 'reply', replyTo: 'h1', comment: 'REPLY-TO-BURNED' },
      { ...base, id: 'h2', index: 0, kind: 'highlight', quads: [box(54, 736, 120, 14)], colour: yellow, comment: 'Kept' },
    ];
    const { bytes, report } = await buildPdf([links()], pages([1]), list);
    expect(report.annotationsFlattened).toBe(1);
    const mine = (await readAll(bytes)).filter((a) => a.author === 'Pat Tester');
    expect(mine.map((a) => a.contents)).toEqual(['Kept']);
    expect(await findEverywhere(bytes, 'REPLY-TO-BURNED')).toEqual([]);
  });

  it("all of a file's own comments, notes included, but not links", async () => {
    const { bytes, report } = await buildPdf([links()], pages([1]), [], { flattenAll: true });
    expect(report.annotationsFlattened).toBeGreaterThanOrEqual(1);
    const left = await readAll(bytes);
    expect(left.filter((a) => a.subtype === 'Text')).toEqual([]);
    expect(left.filter((a) => a.subtype === 'Link').length).toBeGreaterThan(0);
    // The note had no look of its own (readers draw their icon), so ScribeForge drew one.
    const page = await pixels(bytes, 1, false);
    const note = [500, 698, 522, 720].map((v) => v * 1.5); // its rectangle, at the 1.5 scale drawn
    let inked = 0;
    for (let y = Math.floor(page.height - note[3]); y < page.height - note[1]; y++) {
      for (let x = Math.floor(note[0]); x < note[2]; x++) if (page.data[(y * page.width + x) * 4] < 200) inked++;
    }
    expect(inked).toBeGreaterThan(20);
    // The original note's text isn't kept: a burned-in note is only its icon.
    expect(await findEverywhere(bytes, 'NOTE-ON-PAGE-1')).toEqual([]);
  });

  it('a form is placed onto its rectangle as the PDF standard describes', () => {
    expect(placementMatrix([100, 200, 300, 250], [0, 0, 200, 50], [1, 0, 0, 1, 0, 0])).toEqual([1, 0, 0, 1, 100, 200]);
    // Turned a quarter: the 200×50 box becomes 50 wide and 200 tall, placed into a 50×200 rectangle.
    expect(placementMatrix([100, 200, 150, 400], [0, 0, 200, 50], [0, 1, -1, 0, 0, 0])).toEqual([1, 0, 0, 1, 150, 200]);
    expect(placementMatrix([0, 0, 100, 100], [0, 0, 50, 50], [1, 0, 0, 1, 0, 0])).toEqual([2, 0, 0, 2, 0, 0]);
  });
});
