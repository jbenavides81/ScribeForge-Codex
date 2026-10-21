// Stop 1c: annotations added in ScribeForge are saved as standard PDF annotations that another
// reader (pdf.js here, standing in for any reader) reads back exactly.
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFString, StandardFonts, decodePDFRawStream } from '@cantoo/pdf-lib';
import { beforeAll, describe, expect, it } from 'vitest';
import { wrapText } from '../../src/engine/annotate';
import { buildPdf } from '../../src/engine/build';
import type { AnnotationInput, PageItem, Quad, SourceInput } from '../../src/engine/types';
import { ANNOTATION_COLOURS, pdfColour } from '../../src/shared/annotationColours';
import { contrastRatio } from '../../src/shared/themes';
import { annotations, findEverywhere, fixture, strayPages } from './support/inspect';

let links: SourceInput;
const pages = (list: number[], rotate: 0 | 90 = 0): PageItem[] => list.map((n) => ({ kind: 'page', source: 'a', index: n - 1, rotate }));

beforeAll(() => {
  links = { id: 'a', name: 'links.pdf', bytes: fixture('links.pdf') };
}, 120_000);

const box = (x: number, top: number, w: number, h: number): Quad => [x, top, x + w, top, x, top - h, x + w, top - h];
const yellow = pdfColour('#FFE45C');
const red = pdfColour('#B71C1C');
const base = { source: 'a', createdAt: '2026-10-15T12:00:00.000Z', author: 'Pat Tester' };

function sample(): AnnotationInput[] {
  return [
    { ...base, id: 'h1', index: 0, kind: 'highlight', quads: [box(54, 754, 120, 14)], colour: yellow, comment: 'Check this name' },
    { ...base, id: 'u1', index: 0, kind: 'underline', quads: [box(54, 736, 200, 14), box(54, 718, 80, 14)], colour: red },
    { ...base, id: 's1', index: 1, kind: 'strikeout', quads: [box(54, 754, 120, 14)], colour: red, comment: 'Remove' },
    { ...base, id: 'n1', index: 2, kind: 'note', box: box(400, 700, 24, 24), colour: yellow, comment: 'A sticky note on page 3' },
    {
      ...base,
      id: 't1',
      index: 3,
      kind: 'text',
      box: box(54, 600, 200, 20),
      text: 'A text box that is long enough to wrap onto more than one line.',
      colour: red,
      fontSize: 12,
      rotation: 0,
    },
  ];
}

async function ownAnnotations(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  return doc.getPages().flatMap((p, i) => {
    const annots = p.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    return (annots?.asArray() ?? [])
      .map((r) => doc.context.lookup(r) as PDFDict)
      .filter((d) => (d.lookupMaybe(PDFName.of('NM'), PDFString)?.decodeText() ?? '').startsWith('scribeforge-'))
      .map((d) => ({ page: i + 1, dict: d, doc }));
  });
}

describe('annotations', () => {
  it('are saved as standard annotations that read back with their type, text, author and colour', async () => {
    const { bytes, report } = await buildPdf([links], pages([1, 2, 3, 4, 5, 6]), sample());
    expect(report).toMatchObject({ annotationsAdded: 5, annotationsLeftOut: 0 });
    const read = (await annotations(bytes)).filter((a) => a.author === 'Pat Tester');
    expect(read.map((a) => [a.page, a.subtype, a.contents])).toEqual([
      [1, 'Highlight', 'Check this name'],
      [1, 'Underline', ''],
      [2, 'StrikeOut', 'Remove'],
      [3, 'Text', 'A sticky note on page 3'],
      [4, 'FreeText', 'A text box that is long enough to wrap onto more than one line.'],
    ]);
    expect(read[0].colour).toEqual([255, 228, 92]);
    expect(read[1].quads).toBe(2);
    expect(await strayPages(bytes)).toBe(0);
    expect(await findEverywhere(bytes, 'JavaScript')).toEqual([]);
  });

  it('each has its own appearance, a unique name and dates', async () => {
    const { bytes } = await buildPdf([links], pages([1, 2, 3, 4]), sample());
    const own = await ownAnnotations(bytes);
    expect(own).toHaveLength(5);
    const names = own.map((o) => o.dict.lookup(PDFName.of('NM'), PDFString).decodeText());
    expect(new Set(names).size).toBe(5);
    for (const { dict } of own) {
      expect(dict.get(PDFName.of('M'))).toBeDefined();
      expect(dict.get(PDFName.of('CreationDate'))).toBeDefined();
      expect(dict.get(PDFName.of('F'))?.toString()).toBe('4');
      const subtype = dict.get(PDFName.of('Subtype'))?.toString();
      if (subtype !== '/Text') expect(dict.lookupMaybe(PDFName.of('AP'), PDFDict)?.get(PDFName.of('N')), subtype).toBeDefined();
    }
  });

  it('a text box grows to fit its text and is written in Helvetica', async () => {
    const { bytes } = await buildPdf([links], pages([4]), sample().filter((a) => a.kind === 'text'));
    const [text] = (await annotations(bytes)).filter((a) => a.subtype === 'FreeText');
    const [left, bottom, right, top] = text.rect;
    expect(Math.round(right - left)).toBe(200);
    expect(top - bottom).toBeGreaterThan(20 + 14); // at least two lines, not the 20pt it was drawn
    const [own] = await ownAnnotations(bytes);
    expect(own.dict.lookup(PDFName.of('DA'), PDFString).decodeText()).toBe(`/Helv 12 Tf ${red.join(' ')} rg`);
  });

  it('text the standard font can\'t draw shows as "?" in the box but is kept whole in the annotation', async () => {
    const text: AnnotationInput = { ...(sample()[4] as Extract<AnnotationInput, { kind: 'text' }>), text: 'Price 5€ — 日本 ✓' };
    const { bytes } = await buildPdf([links], pages([4]), [text]);
    const [read] = (await annotations(bytes)).filter((a) => a.subtype === 'FreeText');
    expect(read.contents).toBe('Price 5€ — 日本 ✓');
  });

  it('on a turned page, a text box is saved turned back so it reads upright', async () => {
    const turned: AnnotationInput = { ...(sample()[4] as Extract<AnnotationInput, { kind: 'text' }>), index: 1, rotation: 90 };
    const { bytes } = await buildPdf([links], pages([2]), [turned]);
    const [own] = await ownAnnotations(bytes);
    const ap = own.dict.lookup(PDFName.of('AP'), PDFDict).lookup(PDFName.of('N')) as PDFRawStream;
    expect(ap.dict.lookup(PDFName.of('Matrix'), PDFArray).asArray().map(String)).toEqual(['0', '1', '-1', '0', '0', '0']);
    expect(Buffer.from(decodePDFRawStream(ap).decode()).toString('latin1')).toContain('/Helv 12 Tf');
  });

  it('follow their page when pages are reordered, and are left out with deleted pages', async () => {
    const { bytes, report } = await buildPdf([links], pages([4, 1, 3]), sample());
    expect(report).toMatchObject({ annotationsAdded: 4, annotationsLeftOut: 1 });
    const read = (await annotations(bytes)).filter((a) => a.author === 'Pat Tester');
    expect(read.map((a) => [a.page, a.subtype])).toEqual([
      [1, 'FreeText'],
      [2, 'Highlight'],
      [2, 'Underline'],
      [3, 'Text'],
    ]);
    expect(await findEverywhere(bytes, 'Remove')).toEqual([]);
  });

  it('are kept on pages that are turned in the Pages screen', async () => {
    const { bytes } = await buildPdf([links], pages([1], 90), sample().slice(0, 1));
    expect((await annotations(bytes)).filter((a) => a.subtype === 'Highlight')).toHaveLength(1);
  });

  it('are saved without an author when no name is set', async () => {
    const plain = sample().map((a) => ({ ...a, author: undefined }));
    const { bytes } = await buildPdf([links], pages([1]), plain);
    expect((await annotations(bytes)).filter((a) => a.subtype === 'Highlight').map((a) => a.author)).toEqual(['']);
  });

  it('wraps text at spaces and splits words that are too long', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    expect(wrapText('one two three', font, 12, 1000)).toEqual(['one two three']);
    expect(wrapText('one two three', font, 12, font.widthOfTextAtSize('one two', 12))).toEqual(['one two', 'three']);
    expect(wrapText('line one\nline two', font, 12, 1000)).toEqual(['line one', 'line two']);
    expect(wrapText('wwwwwwwwww', font, 12, font.widthOfTextAtSize('www', 12))).toEqual(['www', 'www', 'www', 'w']);
  });
});

describe('annotation colours', () => {
  it('ink colours read clearly on a white page (4.5:1 or more)', () => {
    for (const c of ANNOTATION_COLOURS) expect(contrastRatio(c.ink, '#FFFFFF'), c.name).toBeGreaterThanOrEqual(4.5);
  });
  it('black text stays readable on every highlight colour (7:1 or more)', () => {
    for (const c of ANNOTATION_COLOURS) expect(contrastRatio('#000000', c.highlight), c.name).toBeGreaterThanOrEqual(7);
  });
});
