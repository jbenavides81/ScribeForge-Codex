// Stop 1e: redaction boxes cover their letters exactly. Every word in text-styles.pdf is placed a
// different way (spacing, scaling, rise, kerning, a turned text line, a form, other fonts). For
// each, the box must cover pdf.js's own measure of the word, and after blacking out, no part of
// any letter may show outside the box (Phase 0 found hand-placed boxes leave slivers).
import { createCanvas, loadImage } from '@napi-rs/canvas';
import path from 'node:path';
import type { PDFPageProxy } from 'pdfjs-dist';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import type { Rect } from '../../src/engine/types';
import { burnPage, dpiFor, type MakeSurface } from '../../src/renderer/src/redact/burn';
import { findTerm, glyphsIn, lineBoxes, pageGlyphs, PADDING, type Glyph } from '../../src/renderer/src/redact/glyphs';
import { fixture, ROOT } from './support/inspect';

const FONTS = `${path.join(ROOT, 'node_modules/pdfjs-dist/standard_fonts').replace(/\\/g, '/')}/`;
const API = { OPS: pdfjs.OPS as unknown as Record<string, number>, annotationsOff: pdfjs.AnnotationMode.DISABLE };
const WORDS = ['ALPHA', 'BRAVO', 'CHARLIE', 'DELTA', 'ECHO', 'FOXTROT', 'GOLF', 'HOTEL', 'INDIA', 'JULIET', 'KILO', 'LIMA', 'MIKE', 'NOVEMBER'];

const nodeSurface: MakeSurface = (width, height) => {
  const canvas = createCanvas(width, height);
  return {
    canvas: canvas as unknown as HTMLCanvasElement,
    context: canvas.getContext('2d') as unknown as CanvasRenderingContext2D,
    png: async () => new Uint8Array(canvas.encodeSync('png')),
  };
};

async function openPage(name: string, n: number) {
  const doc = await pdfjs.getDocument({ data: fixture(name), standardFontDataUrl: FONTS, useWorkerFetch: false, verbosity: 0 }).promise;
  return { doc, page: await doc.getPage(n) };
}

describe('letter positions', () => {
  it('match pdf.js’s own measure of every word, however it was placed', async () => {
    const { doc, page } = await openPage('text-styles.pdf', 1);
    const glyphs = await pageGlyphs(page, API);
    const items = (await page.getTextContent()).items.filter((i): i is (typeof i & { str: string; transform: number[]; width: number }) => 'str' in i);
    const compared: string[] = [];
    for (const word of WORDS) {
      const found = findTerm(glyphs, word);
      expect(found.length, word).toBe(1);
      expect(found[0].boxes.length, word).toBe(1);
      const [x0, y0, x1, y1] = found[0].boxes[0];
      // Compared where pdf.js reports the word as one piece of text (with wide letter spacing it
      // reports single letters); every word is also checked by pixels in the next test.
      const item = items.find((i) => i.str === word);
      if (!item) continue;
      compared.push(word);
      // pdf.js's baseline for the word runs from its origin along the text direction.
      const [a, b, , , e, f] = item.transform;
      const length = Math.hypot(a, b);
      const end = [e + (a / length) * item.width, f + (b / length) * item.width];
      for (const [x, y] of [[e, f], end]) {
        expect(x, `${word} baseline x`).toBeGreaterThanOrEqual(x0 - 0.5);
        expect(x, `${word} baseline x`).toBeLessThanOrEqual(x1 + 0.5);
        expect(y, `${word} baseline y`).toBeGreaterThanOrEqual(y0 - 0.5);
        expect(y, `${word} baseline y`).toBeLessThanOrEqual(y1 + 0.5);
      }
      const along = Math.abs(a) >= Math.abs(b) ? x1 - x0 : y1 - y0;
      expect(along, `${word} box length`).toBeLessThanOrEqual(item.width + 2 * PADDING + 1);
    }
    expect(compared.length).toBeGreaterThanOrEqual(9);
    await doc.loadingTask.destroy();
  });

  it('after blacking out, no part of any letter shows outside its box', async () => {
    const { doc, page } = await openPage('text-styles.pdf', 1);
    const glyphs = await pageGlyphs(page, API);
    const boxes = WORDS.flatMap((w) => findTerm(glyphs, w).flatMap((m) => m.boxes));
    const burned = await burnPage(page as unknown as PDFPageProxy, boxes, 200, nodeSurface, API.annotationsOff);
    expect(burned.dpi).toBe(200);
    const image = await loadImage(Buffer.from(burned.png));
    const canvas = createCanvas(image.width, image.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    const { data, width } = ctx.getImageData(0, 0, image.width, image.height);
    const scale = 200 / 72;
    const pixel = (x: number, y: number) => data[(y * width + x) * 4];
    const toPixels = ([a, b, c, d]: Rect) => [Math.floor(a * scale), Math.floor((792 - d) * scale), Math.ceil(c * scale), Math.ceil((792 - b) * scale)];

    for (const [i, box] of boxes.entries()) {
      const [left, top, right, bottom] = toPixels(box);
      // Inside: solid black.
      for (let y = top + 1; y < bottom - 1; y += 2) for (let x = left + 1; x < right - 1; x += 2) expect(pixel(x, y), `box ${i} inside`).toBe(0);
      // A band 6 points wide around it (starting just outside the box): plain white paper.
      const ring = Math.round(6 * scale);
      const dark: string[] = [];
      for (let y = top - ring; y < bottom + ring; y++) {
        for (let x = left - ring; x < right + ring; x++) {
          if (x >= left - 1 && x <= right && y >= top - 1 && y <= bottom) continue;
          if (pixel(x, y) < 235) dark.push(`${x},${y}`);
        }
      }
      expect(dark.slice(0, 5), `${WORDS[i] ?? i}: letter ink outside its box`).toEqual([]);
    }
    await doc.loadingTask.destroy();
  });

  it('finds the term on a page turned sideways, kerned, invisible or on a hidden layer', async () => {
    const turned = await openPage('links.pdf', 2);
    const sideways = findTerm(await pageGlyphs(turned.page, API), 'UNIQUE-PAGE-2');
    expect(sideways.length).toBe(1);
    const [x0, y0, x1, y1] = sideways[0].boxes[0];
    // The page is turned for showing; in its own space the text runs across, as pdf.js says.
    const item = (await turned.page.getTextContent()).items.find((i) => 'str' in i && i.str === 'UNIQUE-PAGE-2') as { transform: number[]; width: number };
    expect(x0).toBeLessThanOrEqual(item.transform[4]);
    expect(x1).toBeGreaterThanOrEqual(item.transform[4] + item.width);
    expect(y0).toBeLessThanOrEqual(item.transform[5]);
    expect(y1).toBeGreaterThan(item.transform[5]);
    await turned.doc.loadingTask.destroy();

    const marked = await openPage('redaction.pdf', 3);
    expect(findTerm(await pageGlyphs(marked.page, API), 'redact-me-term').length).toBe(3);
    await marked.doc.loadingTask.destroy();
  });

  it('matches across spaces and lines, and ignores capitals', () => {
    const g = (text: string, x: number, y: number): Glyph => ({ text, rect: [x, y, x + 6, y + 12] });
    const glyphs = [g('J', 0, 100), g('o', 6, 100), g('h', 12, 100), g('n', 18, 100), g(' ', 24, 100), g('S', 0, 80), g('m', 6, 80), g('i', 12, 80), g('t', 18, 80), g('h', 24, 80)];
    const found = findTerm(glyphs, 'john smith');
    expect(found.length).toBe(1);
    expect(found[0].text).toBe('John Smith');
    expect(found[0].boxes).toEqual([
      [-1, 99, 31, 113],
      [-1, 79, 31, 93],
    ]);
    expect(findTerm(glyphs, '   ')).toEqual([]);
    expect(lineBoxes(glyphsIn(glyphs, [[5, 99, 20, 113]]))).toEqual([[5, 99, 19, 113]]);
  });

  it('draws very large pages at a lower resolution', () => {
    expect(dpiFor([0, 0, 612, 792], 300)).toBe(300);
    expect(dpiFor([0, 0, 2384, 3370], 200)).toBeLessThan(200); // A0
  });
});
