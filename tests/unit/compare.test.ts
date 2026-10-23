// Stop 3c's required checks for comparing versions (docs/Plan_Phase3.md, section 5): a changed word,
// a moved block of text, a changed picture, an added page and a removed page are each found on the
// right page; two identical versions are reported as identical. The parts are checked on their own
// first, then the whole comparison on two real PDFs, drawn by pdf.js as the app draws them.
import { createCanvas } from '@napi-rs/canvas';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { alignPages, changedRegions, compareDocuments, CompareStopped, pageInfo, textChanges, textLines, type CompareSource, type Pixels } from '../../src/engine/compare/compare';
import { diff } from '../../src/engine/compare/diff';
import { fixture, ROOT } from './support/inspect';

const FONTS = `${path.join(ROOT, 'node_modules/pdfjs-dist/standard_fonts').replace(/\\/g, '/')}/`;

/** A version as the app reads it: pdf.js's text, and pages drawn on white. */
async function source(bytes: Uint8Array): Promise<CompareSource> {
  const doc = await pdfjs.getDocument({ data: bytes.slice(), standardFontDataUrl: FONTS, useWorkerFetch: false, verbosity: 0 }).promise;
  return {
    pages: doc.numPages,
    lines: async (n) => textLines((await (await doc.getPage(n)).getTextContent()).items),
    size: async (n) => {
      const v = (await doc.getPage(n)).getViewport({ scale: 1 });
      return { width: v.width, height: v.height };
    },
    draw: async (n, scale) => {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale });
      const canvas = createCanvas(Math.max(1, Math.round(viewport.width)), Math.max(1, Math.round(viewport.height)));
      const context = canvas.getContext('2d');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas: canvas as unknown as HTMLCanvasElement, canvasContext: context as unknown as CanvasRenderingContext2D, viewport }).promise;
      return { data: context.getImageData(0, 0, canvas.width, canvas.height).data, width: canvas.width, height: canvas.height };
    },
  };
}

/** A white picture with dark squares at the given places. */
function picture(width: number, height: number, marks: { x: number; y: number; size: number }[] = []): Pixels {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (const m of marks) {
    for (let y = m.y; y < m.y + m.size; y++) for (let x = m.x; x < m.x + m.size; x++) data.fill(0, (y * width + x) * 4, (y * width + x) * 4 + 3);
  }
  return { data, width, height };
}

describe('the shortest list of changes', () => {
  const show = (a: string, b: string) =>
    diff([...a], [...b])
      .map((op) => (op.kind === 'same' ? a[op.a] : op.kind === 'removed' ? `-${a[op.a]}` : `+${b[op.b]}`))
      .join('');

  it('keeps what is the same and marks what was removed and added', () => {
    expect(show('abcdef', 'abcdef')).toBe('abcdef');
    expect(show('abcdef', 'abXdef')).toBe('ab-c+Xdef');
    expect(show('abc', '')).toBe('-a-b-c');
    expect(show('', 'xy')).toBe('+x+y');
    expect(show('kitten', 'sitting').replace(/[+-]./g, '')).toHaveLength(4); // "ittn" is shared
  });

  it('gives every item of both lists exactly once, in order', () => {
    const a = Array.from({ length: 300 }, (_, i) => (i * 7) % 13);
    const b = Array.from({ length: 280 }, (_, i) => (i * 5) % 11);
    const ops = diff(a, b);
    expect(ops.flatMap((op) => (op.kind === 'added' ? [] : [op.a]))).toEqual(a.map((_, i) => i));
    expect(ops.flatMap((op) => (op.kind === 'removed' ? [] : [op.b]))).toEqual(b.map((_, i) => i));
    for (const op of ops) if (op.kind === 'same') expect(a[op.a]).toBe(b[op.b]);
  });

  it('with very many changes, calls the middle all removed and all added rather than use much memory', () => {
    const a = Array.from({ length: 50 }, (_, i) => `a${i}`);
    const b = Array.from({ length: 50 }, (_, i) => `b${i}`);
    const ops = diff(a, b, undefined, 10);
    expect(ops.filter((op) => op.kind === 'removed')).toHaveLength(50);
    expect(ops.filter((op) => op.kind === 'added')).toHaveLength(50);
  });
});

describe('text changes on a page', () => {
  it('a changed word is listed as removed and added', () => {
    expect(textChanges(['Fees', 'The fee is 100 pounds.'], ['Fees', 'The fee is 120 pounds.'])).toEqual({ removed: ['100'], added: ['120'], moved: [] });
  });

  it('words next to each other are listed together', () => {
    expect(textChanges(['Pay the rent before the fifth day.'], ['Pay the deposit and rent before the tenth day.'])).toEqual({
      removed: ['fifth'],
      added: ['deposit and', 'tenth'],
      moved: [],
    });
  });

  it('a line that moved is listed as moved, not as removed and added', () => {
    expect(textChanges(['Terms', 'Alpha says hello.', 'Beta says goodbye.'], ['Terms', 'Beta says goodbye.', 'Alpha says hello.'])).toEqual({
      removed: [],
      added: [],
      moved: ['Alpha says hello.'],
    });
  });

  it('spacing differences are not changes', () => {
    expect(textChanges(['The  fee   is due. '], [' The fee is due.'])).toEqual({ removed: [], added: [], moved: [] });
  });

  it("reads pdf.js's text items line by line", () => {
    expect(textLines([{ str: 'The fee', hasEOL: false }, { str: ' is due.', hasEOL: true }, { str: 'Next', hasEOL: false }, { type: 'beginMarkedContent' }])).toEqual(['The fee is due.', 'Next']);
  });
});

describe('matching pages', () => {
  const page = (text: string) => pageInfo([text]);
  const pairs = (a: string[], b: string[]) => alignPages(a.map(page), b.map(page)).map((p) => `${p.a === null ? '-' : p.a + 1}:${p.b === null ? '-' : p.b + 1}`);

  it('pages the same, changed, added and removed', () => {
    const one = ['cover page for the lease', 'rent is one hundred pounds a month paid on the first', 'the appendix lists meter readings gas water'];
    const two = ['cover page for the lease', 'a summary added later about deposits and keys', 'rent is one hundred twenty pounds a month paid on the first'];
    expect(pairs(one, two)).toEqual(['1:1', '-:2', '2:3', '3:-']);
  });

  it('two identical lists of pages match one to one', () => {
    const one = ['a b c', 'd e f', 'g h i'];
    expect(pairs(one, one)).toEqual(['1:1', '2:2', '3:3']);
  });

  it('pages without text are matched by how they look', () => {
    const print = (from: number) => {
      const p = new Uint8Array(256).fill(255);
      p.fill(0, from, from + 128);
      return p;
    };
    const a = [pageInfo([], print(0)), pageInfo([], print(128))];
    const b = [pageInfo([], print(128))];
    expect(alignPages(a, b)).toEqual([
      { a: 0, b: null },
      { a: 1, b: 0 },
    ]);
  });
});

describe('where a page looks different', () => {
  it('nothing, when the pictures are the same', () => {
    const p = picture(120, 160, [{ x: 10, y: 10, size: 20 }]);
    expect(changedRegions(p, picture(120, 160, [{ x: 10, y: 10, size: 20 }]))).toEqual([]);
  });

  it('one rectangle around each separate change, nearby changes joined', () => {
    const regions = changedRegions(
      picture(300, 300),
      picture(300, 300, [
        { x: 20, y: 20, size: 10 },
        { x: 34, y: 22, size: 6 }, // close to the first: joined
        { x: 200, y: 250, size: 12 },
      ]),
    );
    expect(regions).toHaveLength(2);
    const [first, second] = regions;
    expect(first.x).toBeLessThanOrEqual(20);
    expect(first.x + first.width).toBeGreaterThanOrEqual(40);
    expect(second.y).toBeLessThanOrEqual(250);
    expect(second.y + second.height).toBeGreaterThanOrEqual(262);
  });

  it('a single stray pixel, as smoothing can leave, is not a change', () => {
    const b = picture(60, 60);
    b.data.fill(0, (30 * 60 + 30) * 4, (30 * 60 + 30) * 4 + 3);
    expect(changedRegions(picture(60, 60), b)).toEqual([]);
  });

  it('a page made bigger: the extra part is a change', () => {
    const regions = changedRegions(picture(100, 100), picture(100, 140, [{ x: 0, y: 100, size: 30 }]));
    expect(regions).toHaveLength(1);
    expect(regions[0].y + regions[0].height).toBeGreaterThan(100);
  });
});

describe('comparing two versions of a real PDF', () => {
  it('finds each kind of change on the right page', async () => {
    const result = await compareDocuments(await source(fixture('version-1.pdf')), await source(fixture('version-2.pdf')));
    expect(result.pages.map((p) => [p.a, p.b, p.status])).toEqual([
      [1, 1, 'same'],
      [null, 2, 'added'],
      [2, 3, 'changed'],
      [3, 4, 'changed'],
      [4, 5, 'changed'],
      [5, null, 'removed'],
    ]);
    expect(result).toMatchObject({ identical: false, same: 1, changed: 3, added: 1, removed: 1 });
    const [, , fee, blocks, picturePage] = result.pages;

    // A changed word: listed, and highlighted on its line (its baseline is 722 points up the page).
    expect(fee.text).toEqual({ removed: ['100'], added: ['120'], moved: [] });
    expect(fee.regions).toHaveLength(1);
    expect(fee.regions[0].y).toBeGreaterThan(792 - 740);
    expect(fee.regions[0].y + fee.regions[0].height).toBeLessThan(792 - 700);

    // A moved block: listed as moved, and both places highlighted.
    expect(blocks.text.removed).toEqual([]);
    expect(blocks.text.added).toEqual([]);
    expect(blocks.text.moved).toHaveLength(1);
    expect(blocks.text.moved[0]).toMatch(/^Block (Alpha|Beta) says/);
    const middles = blocks.regions.map((r) => r.y + r.height / 2).sort((p, q) => p - q);
    expect(middles).toHaveLength(2);
    expect(middles[0]).toBeGreaterThan(792 - 615);
    expect(middles[0]).toBeLessThan(792 - 590);
    expect(middles[1]).toBeGreaterThan(792 - 415);
    expect(middles[1]).toBeLessThan(792 - 390);

    // A changed picture: no words changed, and the panel (x 156 to 456, 300 to 500 points up) highlighted.
    expect(picturePage.text).toEqual({ removed: [], added: [], moved: [] });
    expect(picturePage.regions).toHaveLength(1);
    const panel = picturePage.regions[0];
    expect(panel.x).toBeLessThanOrEqual(157);
    expect(panel.x + panel.width).toBeGreaterThanOrEqual(455);
    expect(panel.y).toBeLessThanOrEqual(792 - 499);
    expect(panel.y + panel.height).toBeGreaterThanOrEqual(792 - 301);
  });

  it('two identical versions are reported as identical', async () => {
    const result = await compareDocuments(await source(fixture('version-1.pdf')), await source(fixture('version-1.pdf')));
    expect(result).toMatchObject({ identical: true, same: 5, changed: 0, added: 0, removed: 0 });
    for (const page of result.pages) expect(page.regions).toEqual([]);
  });

  it('reports its progress, and can be stopped', async () => {
    const steps: string[] = [];
    await compareDocuments(await source(fixture('version-1.pdf')), await source(fixture('version-2.pdf')), {
      onProgress: (stage, done, total) => steps.push(`${stage} ${done}/${total}`),
    });
    expect(steps.at(0)).toBe('reading 1/10');
    expect(steps.at(9)).toBe('reading 10/10');
    expect(steps.at(-1)).toBe('comparing 6/6');
    let calls = 0;
    await expect(compareDocuments(await source(fixture('version-1.pdf')), await source(fixture('version-2.pdf')), { stopped: () => ++calls > 3 })).rejects.toBeInstanceOf(CompareStopped);
  });
});
