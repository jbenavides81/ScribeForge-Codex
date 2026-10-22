// Stop 2c's required checks for finding by pattern: each pattern finds its made-up examples in a
// test PDF and misses its look-alikes; after redacting by pattern, every matched value is found
// nowhere in the new file; and the hints in the redaction log never give a value away.
import { createCanvas } from '@napi-rs/canvas';
import path from 'node:path';
import type { PDFPageProxy } from 'pdfjs-dist';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import { buildPdf } from '../../src/engine/build';
import type { RedactedPage } from '../../src/engine/types';
import { burnPage, type MakeSurface } from '../../src/renderer/src/redact/burn';
import { pageGlyphs } from '../../src/renderer/src/redact/glyphs';
import { classifyNumber, findPatterns, glyphText, luhn, maskHint, textMayMatch, type PatternMatch } from '../../src/renderer/src/redact/patterns';
import { findEverywhere, fixture, pageTexts, ROOT } from './support/inspect';

// The same examples as scripts/make-fixtures.mjs puts in patterns.pdf.
const EXAMPLES = {
  email: ['jane.doe@example.com', 'j.smith+work@mail.example.org'],
  phone: ['(555) 123-4567', '555.987.6543', '+1 555 246 8135', '+44 20 7946 0958'],
  ssn: ['123-45-6789', '234 56 7890'],
  card: ['4111 1111 1111 1111', '5500-0000-0000-0004', '378282246310005'],
  words: ['Project Nightingale'],
};
const LOOKALIKES = ['user@localhost', '2026-10-21', '12345-6789', '000-12-3456', '666-12-3456', '123-00-4567', '4111 1111 1111 1112', '1234567890123456'];

const FONTS = `${path.join(ROOT, 'node_modules/pdfjs-dist/standard_fonts').replace(/\\/g, '/')}/`;
const API = { OPS: pdfjs.OPS as unknown as Record<string, number>, annotationsOff: pdfjs.AnnotationMode.DISABLE };
const nodeSurface: MakeSurface = (width, height) => {
  const canvas = createCanvas(width, height);
  return { canvas: canvas as unknown as HTMLCanvasElement, context: canvas.getContext('2d') as unknown as CanvasRenderingContext2D, png: async () => new Uint8Array(canvas.encodeSync('png')) };
};

/** Every match on every page of patterns.pdf, with the page drawn and blacked out where they are. */
async function search(patterns: ('email' | 'phone' | 'ssn' | 'card')[], words: string[]) {
  const bytes = fixture('patterns.pdf');
  const doc = await pdfjs.getDocument({ data: bytes.slice(), standardFontDataUrl: FONTS, useWorkerFetch: false, verbosity: 0 }).promise;
  const matches: (PatternMatch & { page: number })[] = [];
  const redact: Record<string, RedactedPage> = {};
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const found = findPatterns(await pageGlyphs(page, API), patterns, words);
    matches.push(...found.map((m) => ({ ...m, page: n })));
    if (found.length > 0) redact[`p:${n - 1}`] = await burnPage(page as unknown as PDFPageProxy, found.flatMap((m) => m.boxes), 150, nodeSurface, API.annotationsOff);
  }
  await doc.loadingTask.destroy();
  return { bytes, matches, redact };
}

describe('the pattern rules', () => {
  it('the card-number check (Luhn)', () => {
    expect(luhn('4111111111111111')).toBe(true);
    expect(luhn('4111111111111112')).toBe(false);
    expect(luhn('378282246310005')).toBe(true);
    expect(luhn('1234567890123456')).toBe(false);
  });

  it('runs of digits are sorted into card, Social Security and phone numbers, or nothing', () => {
    expect(classifyNumber('4111 1111 1111 1111')).toBe('card');
    expect(classifyNumber('4111 1111 1111 1112')).toBeNull();
    expect(classifyNumber('123-45-6789')).toBe('ssn');
    expect(classifyNumber('234 56 7890')).toBe('ssn');
    for (const never of ['000-12-3456', '666-12-3456', '900-12-3456', '123-00-4567', '123-45-0000']) expect(classifyNumber(never), never).toBeNull();
    expect(classifyNumber('(555) 123-4567')).toBe('phone');
    expect(classifyNumber('+44 20 7946 0958')).toBe('phone');
    expect(classifyNumber('5551234567')).toBe('phone');
    expect(classifyNumber('555-1234')).toBe('phone');
    for (const never of ['2026-10-21', '12345-6789', '1234567', '1.2.3']) expect(classifyNumber(never), never).toBeNull();
  });

  it('the page text has spaces where letters are spread apart, and a break between lines', () => {
    const g = (text: string, x: number, y: number) => ({ text, rect: [x, y, x + 6, y + 12] as [number, number, number, number] });
    const { text, owner } = glyphText([g('a', 0, 0), g('b', 6, 0), g('c', 16, 0), g('d', 0, 20)]);
    expect(text).toBe('ab c\nd');
    expect(owner).toEqual([0, 1, -1, 2, -1, 3]);
  });
});

describe('finding patterns in a PDF', () => {
  it('each pattern finds its examples and none of the look-alikes', async () => {
    const { matches } = await search(['email', 'phone', 'ssn', 'card'], EXAMPLES.words);
    const by = (p: string) => matches.filter((m) => m.pattern === p).map((m) => m.text);
    expect(by('email')).toEqual(EXAMPLES.email);
    expect(by('phone')).toEqual(EXAMPLES.phone);
    expect(by('ssn')).toEqual(EXAMPLES.ssn);
    expect(by('card')).toEqual(EXAMPLES.card);
    expect(by('words')).toEqual(EXAMPLES.words);
    for (const look of LOOKALIKES) expect(matches.some((m) => m.text.includes(look)), look).toBe(false);
    expect(matches.map((m) => m.page)).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2]);
  });

  it('only the patterns chosen', async () => {
    const { matches } = await search(['ssn'], []);
    expect(matches.map((m) => m.text)).toEqual(EXAMPLES.ssn);
  });

  it('after redacting by pattern, every matched value is found nowhere (the Phase 1 check)', async () => {
    const { bytes, matches, redact } = await search(['email', 'phone', 'ssn', 'card'], EXAMPLES.words);
    const values = matches.map((m) => m.text);
    const before = await Promise.all(values.map((v) => findEverywhere(bytes, v)));
    // Each value really is in the original, as one piece of text.
    for (const [i, hits] of before.entries()) expect(hits.length, values[i]).toBeGreaterThan(0);
    const { bytes: out, found } = await buildPdf([{ id: 'p', name: 'patterns.pdf', bytes }], [0, 1].map((index) => ({ kind: 'page', source: 'p', index, rotate: 0 })), [], { redact, verifyTerms: values });
    expect(found).toEqual([]);
    for (const v of values) expect(await findEverywhere(out, v), v).toEqual([]);
    expect((await pageTexts(out)).every((t) => t === '')).toBe(true);
  });

  it('a page whose text has nothing that could match is skipped quickly', () => {
    expect(textMayMatch('Nothing to see here', ['email', 'phone'], [])).toBe(false);
    expect(textMayMatch('Write to a@b.co', ['email'], [])).toBe(true);
    expect(textMayMatch('Call 555 123 4567', ['phone'], [])).toBe(true);
    expect(textMayMatch('The project nightingale', [], ['Project  Nightingale'])).toBe(true);
  });
});

describe('hints in the redaction log', () => {
  it('give a hint without giving the value away', async () => {
    expect(maskHint('jane.doe@example.com', 'email')).toBe('j•••@e•••.com');
    expect(maskHint('(555) 123-4567', 'phone')).toBe('(•••) •••-••67');
    expect(maskHint('4111 1111 1111 1111', 'card')).toBe('•••• •••• •••• ••11');
    expect(maskHint('123-45-6789', 'ssn')).toBe('•••-••-••••');
    expect(maskHint('Project Nightingale', 'words')).toBe('P••• N•••');
    expect(maskHint('A to Z')).toBe('••• ••• •••');
    const { matches } = await search(['email', 'phone', 'ssn', 'card'], EXAMPLES.words);
    for (const m of matches) {
      const hint = maskHint(m.text, m.pattern);
      expect(hint.includes(m.text), m.text).toBe(false);
      expect(hint.replace(/\D/g, '').length, m.text).toBeLessThanOrEqual(2);
    }
  });
});
