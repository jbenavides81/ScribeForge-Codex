// Stop 1e's required checks for redaction: the test term, placed in body text (plain, kerned,
// invisible and on a hidden layer), a comment, the title and XMP, a bookmark, an attachment's
// name and contents, a script, and hidden page data, is found nowhere after redacting with the
// default settings; unmarked pages are identical to the source pages; the original is unchanged.
import { createCanvas } from '@napi-rs/canvas';
import { decodePDFRawStream, PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, StandardFonts } from '@cantoo/pdf-lib';
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { PDFPageProxy } from 'pdfjs-dist';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import { buildPdf } from '../../src/engine/build';
import { inspectPdf } from '../../src/engine/inspect';
import type { PageItem, RedactedPage, SourceInput } from '../../src/engine/types';
import { burnPage, type MakeSurface } from '../../src/renderer/src/redact/burn';
import { findTerm, pageGlyphs } from '../../src/renderer/src/redact/glyphs';
import { findEverywhere, fixture, links, pageTexts, ROOT } from './support/inspect';

const TERM = 'REDACT-ME-TERM';
const FONTS = `${path.join(ROOT, 'node_modules/pdfjs-dist/standard_fonts').replace(/\\/g, '/')}/`;
const API = { OPS: pdfjs.OPS as unknown as Record<string, number>, annotationsOff: pdfjs.AnnotationMode.DISABLE };
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const pages = (id: string, list: number[], rotate: 0 | 90 = 0): PageItem[] => list.map((n) => ({ kind: 'page', source: id, index: n - 1, rotate }));

const nodeSurface: MakeSurface = (width, height) => {
  const canvas = createCanvas(width, height);
  return {
    canvas: canvas as unknown as HTMLCanvasElement,
    context: canvas.getContext('2d') as unknown as CanvasRenderingContext2D,
    png: async () => new Uint8Array(canvas.encodeSync('png')),
  };
};

const open = (bytes: Uint8Array) => pdfjs.getDocument({ data: bytes.slice(), standardFontDataUrl: FONTS, useWorkerFetch: false, verbosity: 0 }).promise;

/** What the app does: search every page for the term, and black out each page it's on. */
async function searchAndBurn(source: SourceInput, term: string, dpi = 200): Promise<Record<string, RedactedPage>> {
  const doc = await open(source.bytes);
  const redact: Record<string, RedactedPage> = {};
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const boxes = findTerm(await pageGlyphs(page, API), term).flatMap((m) => m.boxes);
    if (boxes.length > 0) redact[`${source.id}:${n - 1}`] = await burnPage(page as unknown as PDFPageProxy, boxes, dpi, nodeSurface, API.annotationsOff);
  }
  await doc.loadingTask.destroy();
  return redact;
}

/** A page drawn without comments, as pixels. */
async function pixels(bytes: Uint8Array, n: number): Promise<Uint8ClampedArray> {
  const doc = await open(bytes);
  const page = await doc.getPage(n);
  const viewport = page.getViewport({ scale: 1 });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const context = canvas.getContext('2d');
  await page.render({ canvas: canvas as unknown as HTMLCanvasElement, canvasContext: context as unknown as CanvasRenderingContext2D, viewport, annotationMode: pdfjs.AnnotationMode.DISABLE }).promise;
  await doc.loadingTask.destroy();
  return context.getImageData(0, 0, canvas.width, canvas.height).data;
}

/** A page's content streams, decoded and joined. */
async function content(bytes: Uint8Array, n: number): Promise<string> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const node = doc.getPage(n - 1).node;
  const contents = node.lookup(PDFName.of('Contents'));
  const streams = contents instanceof PDFArray ? contents.asArray().map((r) => doc.context.lookup(r)) : [contents];
  return streams.map((s) => Buffer.from(decodePDFRawStream(s as PDFRawStream).decode()).toString('latin1')).join('\n');
}

describe('redaction', () => {
  it('the test term is found nowhere after redacting with the default settings', async () => {
    const source: SourceInput = { id: 'r', name: 'redaction.pdf', bytes: fixture('redaction.pdf') };
    const before = sha(source.bytes);
    // The term really is in all those places to begin with.
    expect((await findEverywhere(source.bytes, TERM)).length).toBeGreaterThanOrEqual(8);

    const redact = await searchAndBurn(source, TERM);
    expect(Object.keys(redact).sort()).toEqual(['r:1', 'r:2']); // pages 2 and 3; page 1 has none
    const { bytes, report, found } = await buildPdf([source], pages('r', [1, 2, 3]), [], { redact, verifyTerms: [TERM], producer: 'ScribeForge 0.5.0' });

    expect(await findEverywhere(bytes, TERM)).toEqual([]);
    expect(found).toEqual([]);
    expect(sha(source.bytes)).toBe(before);

    // Marked pages are images now: no text at all. The unmarked page reads exactly as before.
    const texts = await pageTexts(bytes);
    const sourceTexts = await pageTexts(source.bytes);
    expect(texts[0]).toBe(sourceTexts[0]);
    expect(texts[1]).toBe('');
    expect(texts[2]).toBe('');

    // What the summary says was left out.
    expect(report).toMatchObject({ pages: 3, pagesRedacted: 2, commentsLeftOut: 1, bookmarksLeftOut: 1, attachmentsLeftOut: 1 });
    expect(report.actionsRemoved).toBeGreaterThanOrEqual(1);

    // Only pages and the links between them: the link on page 1 still goes to page 3.
    expect((await links(bytes)).filter((l) => l.kind === 'page').map((l) => [l.page, l.target])).toEqual([[1, 3]]);
    const { carries } = await inspectPdf({ id: 'out', name: 'out.pdf', bytes });
    expect(carries.details.map((d) => d.key)).toEqual(['Creator', 'Producer', 'CreationDate', 'ModDate']);
    expect(carries).toMatchObject({ attachments: [], formFields: [], actions: [], bookmarks: 0, layers: [], comments: { total: 0 } });
  });

  it('unmarked pages are identical to the source pages', async () => {
    const source: SourceInput = { id: 'r', name: 'redaction.pdf', bytes: fixture('redaction.pdf') };
    const { bytes } = await buildPdf([source], pages('r', [1, 2, 3]), [], { redact: await searchAndBurn(source, TERM) });
    expect(await content(bytes, 1)).toBe(await content(source.bytes, 1));
    expect(Buffer.from(await pixels(bytes, 1)).equals(Buffer.from(await pixels(source.bytes, 1)))).toBe(true);
  });

  it('a redacted page keeps its size and is turned the way it was, plus any turn from the Pages screen', async () => {
    const source: SourceInput = { id: 'l', name: 'links.pdf', bytes: fixture('links.pdf') };
    const redact = await searchAndBurn(source, 'UNIQUE-PAGE-2');
    expect(Object.keys(redact)).toEqual(['l:1']);
    const { bytes } = await buildPdf([source], [...pages('l', [1]), ...pages('l', [2], 90)], [], { redact });
    const doc = await PDFDocument.load(bytes);
    const original = (await PDFDocument.load(source.bytes)).getPage(1);
    expect(doc.getPage(1).getRotation().angle).toBe((original.getRotation().angle + 90) % 360);
    expect(doc.getPage(1).getSize()).toEqual(original.getSize());
    expect(await findEverywhere(bytes, 'UNIQUE-PAGE-2')).toEqual([]);
  });

  it('an image or drawing shared between pages doesn’t ride along with an unmarked page', async () => {
    // Two pages sharing one list of resources; a drawing holding the term is only used on page 2.
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const secret = doc.context.register(
      doc.context.flateStream(`BT /F1 12 Tf 72 600 Td (${TERM}) Tj ET`, { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 612, 792], Resources: { Font: { F1: font.ref } } }),
    );
    const shared = doc.context.register(doc.context.obj({ Font: { F1: font.ref }, XObject: { Secret: secret } }));
    for (const text of ['SHARED-PAGE-ONE', 'SHARED-PAGE-TWO']) {
      const page = doc.addPage([612, 792]);
      page.node.set(PDFName.of('Resources'), shared);
      const draw = text.endsWith('TWO') ? ' /Secret Do' : '';
      page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.flateStream(`BT /F1 12 Tf 72 700 Td (${text}) Tj ET${draw}`)));
    }
    const source: SourceInput = { id: 's', name: 'shared.pdf', bytes: await doc.save() };
    const redact = await searchAndBurn(source, TERM);
    expect(Object.keys(redact)).toEqual(['s:1']);
    const { bytes, found } = await buildPdf([source], pages('s', [1, 2]), [], { redact, verifyTerms: [TERM] });
    expect(await findEverywhere(bytes, TERM)).toEqual([]);
    expect(found).toEqual([]);
    expect((await pageTexts(bytes))[0]).toBe('SHARED-PAGE-ONE');
  });

  it('the last check finds a term that is still in the file', async () => {
    const source: SourceInput = { id: 'r', name: 'redaction.pdf', bytes: fixture('redaction.pdf') };
    const all = await searchAndBurn(source, TERM);
    const onlyPage2 = { 'r:1': all['r:1'] }; // page 3 left unredacted
    const { found } = await buildPdf([source], pages('r', [1, 2, 3]), [], { redact: onlyPage2, verifyTerms: [TERM, 'ab'] });
    expect(found).toEqual([TERM]); // and terms under 3 letters aren't checked
    // The file's own workings don't count: Helvetica is a font name here, not text on a page.
    const { found: none } = await buildPdf([source], pages('r', [1, 2, 3]), [], { redact: all, verifyTerms: ['Helvetica'] });
    expect(none).toEqual([]);
  });

  it('hidden layers on kept pages stay hidden, and only those layers come along', async () => {
    const source: SourceInput = { id: 'c', name: 'carries.pdf', bytes: fixture('carries.pdf') };
    const redact = await searchAndBurn(source, 'CARRIES-PAGE-2');
    const { bytes } = await buildPdf([source], pages('c', [1, 2]), [], { redact });
    expect((await inspectPdf({ id: 'o', name: 'o.pdf', bytes })).carries.layers).toEqual([
      { name: 'Visible layer', hidden: false },
      { name: 'Hidden layer', hidden: true },
    ]);
    // A file whose only layer is on a redacted page keeps no layers.
    const r: SourceInput = { id: 'r', name: 'redaction.pdf', bytes: fixture('redaction.pdf') };
    const out = (await buildPdf([r], pages('r', [1, 2, 3]), [], { redact: await searchAndBurn(r, TERM) })).bytes;
    const catalog = (await PDFDocument.load(out)).catalog;
    expect(catalog.lookupMaybe(PDFName.of('OCProperties'), PDFDict)).toBeUndefined();
    expect(await findEverywhere(out, 'Draft notes')).toEqual([]);
  });
});

describe('the last check reads text the way pages hold it', () => {
  it('finds text in literal and hex strings, escaped or split, and ignores names and comments', async () => {
    const { contentStrings } = await import('../../src/engine/redact');
    expect(contentStrings(String.raw`BT /F1 12 Tf (Hello \(world\)) Tj ET`)).toBe('Hello (world)');
    expect(contentStrings('[(REDACT-) -10 (ME-TERM)] TJ')).toBe('REDACT-ME-TERM');
    expect(contentStrings('<48656C6C6F> Tj <<2 0 R>> /Helvetica-123 9 Tf')).toBe('Hello');
    expect(contentStrings(String.raw`(\101\102C) Tj % (not this)` + '\n(D) Tj')).toBe('ABCD');
    expect(contentStrings('(a(b)c) Tj <4>')).toBe('a(b)c@');
  });
});
