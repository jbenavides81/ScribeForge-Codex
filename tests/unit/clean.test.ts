// Stop 2d's required checks for the engine: a file carrying one of each item is cleaned of
// everything, after which "what this file carries" reads None for each and each item's test text is
// found nowhere; removing only some items leaves the rest exactly as they were; and taking out
// what's on a hidden layer leaves the page looking the same, pixel for pixel.
import { createCanvas } from '@napi-rs/canvas';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFString, StandardFonts } from '@cantoo/pdf-lib';
import path from 'node:path';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import { buildPdf } from '../../src/engine/build';
import { isHiddenEntry } from '../../src/engine/hiddenLayers';
import { inspectPdf } from '../../src/engine/inspect';
import type { BuildOptions, Carries, CleanOptions, PageItem, SourceInput } from '../../src/engine/types';
import { findEverywhere, fixture, pageTexts, ROOT } from './support/inspect';

const FONTS = `${path.join(ROOT, 'node_modules/pdfjs-dist/standard_fonts').replace(/\\/g, '/')}/`;
const pages = (n: number, source = 'c'): PageItem[] => Array.from({ length: n }, (_, i) => ({ kind: 'page', source, index: i, rotate: 0 }));
const carriesOf = async (bytes: Uint8Array) => (await inspectPdf({ id: 'x', name: 'x.pdf', bytes })).carries;

/** carries.pdf, plus hidden page data on page 1: data another program keeps, and a thumbnail. */
async function carriesSource(): Promise<SourceInput> {
  const doc = await PDFDocument.load(fixture('carries.pdf'), { updateMetadata: false });
  const page = doc.getPage(0).node;
  page.set(PDFName.of('PieceInfo'), doc.context.obj({ OtherApp: { Private: PDFString.of('PIECE-DATA-SECRET') } }));
  page.set(PDFName.of('Thumb'), doc.context.register(doc.context.stream(new Uint8Array(12), { Width: 2, Height: 2, ColorSpace: 'DeviceRGB', BitsPerComponent: 8 })));
  return { id: 'c', name: 'carries.pdf', bytes: await doc.save({ updateFieldAppearances: false }) };
}

/** Each item's test text in carries.pdf, by item. */
const TEST_TEXT: Record<string, string[]> = {
  details: ['CARRIES-OLD-TITLE', 'Fixture Author', 'Fixture Company Ltd', 'Fixture Writer 1.0', 'alpha, beta'],
  attachments: ['ATTACHMENT-SECRET-TEXT', 'PAGE-ATTACHMENT-TEXT', 'page-file.txt', 'notes.txt'],
  scripts: ['CARRIES SCRIPT', 'calc.exe'],
  formFields: ['FIELD-VALUE', 'customer.name'],
  comments: ['A fixture note', 'Second Reviewer'],
  hiddenLayers: ['HIDDEN-LAYER-TEXT', 'Hidden layer'],
  bookmarks: ['Chapter one', 'Chapter two'],
  pageData: ['PIECE-DATA-SECRET'],
};

const EVERYTHING: CleanOptions = {
  details: true,
  attachments: true,
  formFields: 'remove',
  comments: 'remove',
  hiddenLayers: true,
  bookmarks: true,
  pageData: true,
};

async function pixels(bytes: Uint8Array, n: number) {
  const doc = await pdfjs.getDocument({ data: bytes.slice(), standardFontDataUrl: FONTS, useWorkerFetch: false, verbosity: 0 }).promise;
  const page = await doc.getPage(n);
  const viewport = page.getViewport({ scale: 1.5 });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas: canvas as unknown as HTMLCanvasElement, canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport, annotationMode: pdfjs.AnnotationMode.ENABLE }).promise;
  await doc.loadingTask.destroy();
  return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
}

function differences(a: Uint8ClampedArray, b: Uint8ClampedArray): { count: number; largest: number } {
  let count = 0;
  let largest = 0;
  for (let i = 0; i < a.length; i += 4) {
    const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
    if (d) count++;
    largest = Math.max(largest, d);
  }
  return { count, largest };
}

describe('cleaning a file', () => {
  it('of everything: what it carries reads None for each item, and each test text is found nowhere', async () => {
    const source = await carriesSource();
    const before = await carriesOf(source.bytes);
    expect(before.pageData).toBe(1);
    const { bytes, report } = await buildPdf([source], pages(2), [], { clean: EVERYTHING, producer: 'ScribeForge 1.4.0' });
    const after = await carriesOf(bytes);
    // Only what says ScribeForge made it, and when.
    expect(after.details.map((d) => d.key)).toEqual(['Creator', 'Producer', 'CreationDate', 'ModDate']);
    expect(after).toMatchObject({ attachments: [], formFields: [], actions: [], bookmarks: 0, pageData: 0, comments: { total: 0 } });
    // The visible layer stays; the hidden one, and what was on it, are gone.
    expect(after.layers).toEqual([{ name: 'Visible layer', hidden: false }]);
    for (const [item, texts] of Object.entries(TEST_TEXT)) {
      for (const text of texts) expect(await findEverywhere(bytes, text), `${item}: ${text}`).toEqual([]);
    }
    expect(report).toMatchObject({ attachmentsRemoved: 1, formFieldsRemoved: 2, commentsRemoved: 2, layersRemoved: 1, hiddenSectionsRemoved: 1, bookmarksCleared: 2, pageDataRemoved: 1 });
    expect(report.detailsRemoved).toBeGreaterThanOrEqual(8);
    // The pages still read as before.
    const texts = await pageTexts(bytes);
    expect(texts[0]).toContain('CARRIES-PAGE-1');
    expect(texts[0]).toContain('VISIBLE-LAYER-TEXT');
    expect(texts[1]).toContain('CARRIES-PAGE-2');
  });

  it('removing only some items leaves the rest exactly as they were', async () => {
    const source = await carriesSource();
    const plain = await buildPdf([source], pages(2), [], { producer: 'ScribeForge 1.4.0' });
    const plainCarries = await carriesOf(plain.bytes);
    const plainTexts = await pageTexts(plain.bytes);
    // A new file's field boxes are no longer form fields (they're detached), so they're counted here.
    const fieldBoxes = async (bytes: Uint8Array) => {
      const doc = await PDFDocument.load(bytes, { updateMetadata: false });
      return doc.getPages().flatMap((p) => (p.node.lookupMaybe(PDFName.of('Annots'), PDFArray)?.asArray() ?? []).filter((r) => (doc.context.lookup(r) as PDFDict).get(PDFName.of('Subtype'))?.toString() === '/Widget')).length;
    };
    const only: [keyof CleanOptions, CleanOptions, keyof Carries | null][] = [
      ['details', { details: true }, 'details'],
      ['attachments', { attachments: true }, 'attachments'],
      ['formFields', { formFields: 'remove' }, null],
      ['comments', { comments: 'remove' }, 'comments'],
      ['hiddenLayers', { hiddenLayers: true }, 'layers'],
      ['bookmarks', { bookmarks: true }, 'bookmarks'],
      ['pageData', { pageData: true }, 'pageData'],
    ];
    expect(await fieldBoxes(plain.bytes)).toBe(2);
    for (const [item, clean, key] of only) {
      const { bytes } = await buildPdf([source], pages(2), [], { clean, producer: 'ScribeForge 1.4.0' });
      const cleaned = await carriesOf(bytes);
      if (key) expect(cleaned[key], item).not.toEqual(plainCarries[key]);
      expect(await fieldBoxes(bytes), item).toBe(item === 'formFields' ? 0 : 2);
      // Everything else as a plain new file has it.
      const rest = (c: Carries) => ({ ...c, ...(key ? { [key]: undefined } : {}), details: item === 'details' ? undefined : c.details.filter((d) => d.key !== 'ModDate') });
      expect(rest(cleaned), item).toEqual(rest(plainCarries));
      // And the other items' test text is still there.
      for (const [other, texts] of Object.entries(TEST_TEXT)) {
        if (other === item || other === 'scripts' || (other === 'attachments' && item !== 'attachments')) continue;
        for (const text of texts) {
          const where = await findEverywhere(bytes, text);
          if ((await findEverywhere(plain.bytes, text)).length > 0) expect(where.length, `${item} kept ${other}: ${text}`).toBeGreaterThan(0);
        }
      }
      if (item !== 'hiddenLayers') expect(await pageTexts(bytes), item).toEqual(plainTexts);
    }
  });

  it("taking out what's on a hidden layer: the page looks the same, and the hidden text is found nowhere", async () => {
    const source = await carriesSource();
    const plain = await buildPdf([source], pages(2), [], { producer: 'ScribeForge 1.4.0' });
    const cleaned = await buildPdf([source], pages(2), [], { clean: { hiddenLayers: true }, producer: 'ScribeForge 1.4.0' });
    expect(await findEverywhere(plain.bytes, 'HIDDEN-LAYER-TEXT')).not.toEqual([]);
    expect(await findEverywhere(cleaned.bytes, 'HIDDEN-LAYER-TEXT')).toEqual([]);
    expect(await findEverywhere(cleaned.bytes, 'VISIBLE-LAYER-TEXT')).not.toEqual([]);
    for (const n of [1, 2]) expect(differences(await pixels(plain.bytes, n), await pixels(cleaned.bytes, n)), `page ${n}`).toEqual({ count: 0, largest: 0 });
  });

  it('form fields burned in keep their look, pixel for pixel, but are no longer fields', async () => {
    const source = await carriesSource();
    const plain = await buildPdf([source], pages(2), [], { producer: 'ScribeForge 1.4.0' });
    const burned = await buildPdf([source], pages(2), [], { clean: { formFields: 'flatten' }, producer: 'ScribeForge 1.4.0' });
    expect(burned.report).toMatchObject({ formFieldsFlattened: 2, annotationsNotFlattened: 0 });
    // The field's value still shows (it's part of the page now), and the page looks the same.
    expect((await pageTexts(burned.bytes))[0]).toContain('FIELD-VALUE');
    expect(differences(await pixels(plain.bytes, 1), await pixels(burned.bytes, 1))).toEqual({ count: 0, largest: 0 });
    const annots = await PDFDocument.load(burned.bytes).then((d) => d.getPage(0).node.lookupMaybe(PDFName.of('Annots'), PDFArray)?.asArray() ?? []);
    expect(annots.length).toBe(4); // the note, the highlight and two links; no field boxes
  });

  it('comments burned in become part of the page; those with no look of their own are drawn by ScribeForge', async () => {
    const source = await carriesSource();
    const burned = await buildPdf([source], pages(2), [], { clean: { comments: 'flatten' }, producer: 'ScribeForge 1.4.0' });
    // carries.pdf's note and highlight have no look of their own (readers draw them).
    expect(burned.report).toMatchObject({ annotationsFlattened: 2, annotationsNotFlattened: 0 });
    expect((await carriesOf(burned.bytes)).comments.total).toBe(0);
    // Drawn where they were: the note's corner and the highlight's middle aren't white any more.
    const page = await pixels(burned.bytes, 1);
    const at = (x: number, y: number) => {
      const i = (Math.round((792 - y) * 1.5) * Math.ceil(612 * 1.5) + Math.round(x * 1.5)) * 4;
      return [page[i], page[i + 1], page[i + 2]];
    };
    expect(at(510, 710)).not.toEqual([255, 255, 255]);
    expect(at(150, 722)).not.toEqual([255, 255, 255]);
    expect(await findEverywhere(burned.bytes, 'A fixture note')).toEqual([]);
  });

  it('hidden text in the middle of a shown line is left in place, so the shown text never moves', async () => {
    const doc = await PDFDocument.create({ updateMetadata: false });
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([612, 792]);
    const F = page.node.newFontDictionary('F', font.ref).decodeText();
    const layer = doc.context.register(doc.context.obj({ Type: 'OCG', Name: PDFString.of('Draft') }));
    doc.catalog.set(PDFName.of('OCProperties'), doc.context.obj({ OCGs: [layer], D: { OFF: [layer] } }));
    page.node.Resources()?.set(PDFName.of('Properties'), doc.context.obj({ D1: layer }));
    page.node.addContentStream(doc.context.register(doc.context.flateStream(`BT /${F} 12 Tf 54 700 Td (Shown ) Tj /OC /D1 BDC (MID-LINE-HIDDEN ) Tj EMC (and shown) Tj ET`)));
    const { bytes, report } = await buildPdf([{ id: 'm', name: 'm.pdf', bytes: await doc.save() }], pages(1, 'm'), [], { clean: { hiddenLayers: true } });
    expect(report).toMatchObject({ hiddenContentKept: 1, layersRemoved: 0 });
    // Still there, and still hidden.
    expect(await findEverywhere(bytes, 'MID-LINE-HIDDEN ')).not.toEqual([]);
    expect((await carriesOf(bytes)).layers).toEqual([{ name: 'Draft', hidden: true }]);
  });

  it('works out which layers and layer combinations are hidden', async () => {
    const doc = await PDFDocument.create();
    const a = doc.context.register(doc.context.obj({ Type: 'OCG', Name: 'A' }));
    const b = doc.context.register(doc.context.obj({ Type: 'OCG', Name: 'B' }));
    const hidden = new Set([String(b)]);
    const md = (p: string) => doc.context.obj({ Type: 'OCMD', OCGs: [a, b], P: p });
    expect(isHiddenEntry(doc, a, hidden)).toBe(false);
    expect(isHiddenEntry(doc, b, hidden)).toBe(true);
    expect(isHiddenEntry(doc, md('AnyOn'), hidden)).toBe(false);
    expect(isHiddenEntry(doc, md('AllOn'), hidden)).toBe(true);
    expect(isHiddenEntry(doc, md('AnyOff'), hidden)).toBe(false);
    expect(isHiddenEntry(doc, md('AllOff'), hidden)).toBe(true);
    expect(isHiddenEntry(doc, doc.context.obj({ Type: 'OCMD', OCGs: b }), hidden)).toBe(true);
    // A combination written as an expression counts as shown: nothing that might show is removed.
    expect(isHiddenEntry(doc, doc.context.obj({ Type: 'OCMD', OCGs: [b], VE: [PDFName.of('Not'), a] }), hidden)).toBe(false);
  });
});

describe('what a redacted file keeps', () => {
  const marked = async (keep: BuildOptions['keep']) => {
    const source = await carriesSource();
    // Page 2 is redacted (a blank picture stands in); page 1 has no marks.
    const blank = createCanvas(10, 10);
    const ctx = blank.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 10, 10);
    const redact = { 'c:1': { png: new Uint8Array(blank.encodeSync('png')), view: [0, 0, 842, 595] as [number, number, number, number], dpi: 72 } };
    return buildPdf([source], pages(2), [], { redact, keep, producer: 'ScribeForge 1.4.0' });
  };

  it('nothing but pages and the links between them, by default', async () => {
    const after = await carriesOf((await marked(undefined)).bytes);
    expect(after).toMatchObject({ formFields: [], attachments: [], bookmarks: 0, comments: { total: 0 } });
    expect(after.details.map((d) => d.key)).toEqual(['Creator', 'Producer', 'CreationDate', 'ModDate']);
  });

  it('the details, bookmarks, and comments and form fields on pages without marks, when chosen', async () => {
    const { bytes, report } = await marked({ details: true, bookmarks: true, comments: true, formFields: true });
    const after = await carriesOf(bytes);
    expect(after.details.find((d) => d.key === 'Title')?.value).toBe('CARRIES-OLD-TITLE');
    expect(after.bookmarks).toBe(2);
    expect(after.comments.total).toBe(2);
    // The field boxes on page 1 stay (detached from the form, as in any new file).
    expect(after.formFields).toEqual([]);
    expect(report.formFieldsLeftOut).toBe(0);
    // The marked page has none of them: it's a picture.
    expect((await pageTexts(bytes))[1]).toBe('');
  });

  it('files attached to pages without marks, when chosen', async () => {
    const source = await carriesSource();
    const blank = createCanvas(10, 10);
    blank.getContext('2d').fillRect(0, 0, 10, 10);
    const redact = { 'c:0': { png: new Uint8Array(blank.encodeSync('png')), view: [0, 0, 612, 792] as [number, number, number, number], dpi: 72 } };
    const kept = await carriesOf((await buildPdf([source], pages(2), [], { redact, keep: { attachments: true } })).bytes);
    expect(kept.attachments.map((a) => a.name)).toEqual(['page-file.txt']);
  });
});

// The fixture's annotations, by subtype, for the record.
it('carries.pdf has what these tests rely on', async () => {
  const doc = await PDFDocument.load(fixture('carries.pdf'));
  const subtypes = doc.getPages().flatMap((p) => (p.node.lookupMaybe(PDFName.of('Annots'), PDFArray)?.asArray() ?? []).map((r) => (doc.context.lookup(r) as PDFDict).get(PDFName.of('Subtype'))?.toString()));
  expect(subtypes.sort()).toEqual(['/FileAttachment', '/Highlight', '/Link', '/Link', '/Link', '/Text', '/Widget', '/Widget']);
});
