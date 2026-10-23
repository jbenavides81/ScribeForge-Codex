// Comparing two versions of a document, page by page (stop 3c): which pages match, which were
// added or removed, the words added, removed and moved on each page, and where its pixels changed.
// Pages are drawn and read by the caller (pdf.js in the window, or in the tests), so this file has
// no screen parts and can be tested on its own.
import { diff } from './diff';

/** A page drawn as RGBA pixels, on white. */
export interface Pixels {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}

/** A rectangle on a page, in points from its top-left corner. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One version, as the comparison reads it. Pages are numbered from 1. */
export interface CompareSource {
  pages: number;
  /** A page's text, line by line. */
  lines(page: number): Promise<string[]>;
  /** A page's size in points, as shown (rotation included). */
  size(page: number): Promise<{ width: number; height: number }>;
  /** A page drawn at `scale` (1 is one pixel per point), on white. */
  draw(page: number, scale: number): Promise<Pixels>;
}

export interface TextChanges {
  /** Runs of words only in the first version. */
  removed: string[];
  /** Runs of words only in the second version. */
  added: string[];
  /** Lines in both, but in a different place on the page. */
  moved: string[];
}

export interface PageComparison {
  /** The page in the first version, or null if it was added. */
  a: number | null;
  /** The page in the second version, or null if it was removed. */
  b: number | null;
  status: 'same' | 'changed' | 'added' | 'removed';
  /** Where the page looks different, in points: the same places on both pages. */
  regions: Rect[];
  text: TextChanges;
}

export interface Comparison {
  pages: PageComparison[];
  identical: boolean;
  same: number;
  changed: number;
  added: number;
  removed: number;
}

/** Pages whose words are at least this alike are taken to be the same page, changed. */
export const SAME_PAGE = 0.5;
/** Pages are compared drawn this many pixels wide. */
export const DRAW_WIDTH = 700;
/** Pixels are compared in squares this size; a square with changed pixels is highlighted. */
export const CELL = 6;
/** How much a pixel's colour must change to count (out of 255), so smoothing at edges doesn't. */
const PIXEL_CHANGE = 48;
/** Pages without text are matched by a small picture, this many squares across and down. */
const PRINT_SIZE = 16;

// ---- Text ----

/** A line with its spacing tidied, or '' if there's nothing on it. */
const tidy = (line: string) => line.replace(/\s+/g, ' ').trim();

export const wordsOf = (lines: readonly string[]): string[] => lines.flatMap((l) => tidy(l).split(' ').filter(Boolean));

/** A page's lines, from pdf.js's text items (each with `str`, and `hasEOL` where a line ends). */
export function textLines(items: readonly unknown[]): string[] {
  const lines: string[] = [];
  let line = '';
  for (const item of items) {
    if (typeof item !== 'object' || item === null || !('str' in item)) continue;
    const { str, hasEOL } = item as { str: string; hasEOL?: boolean };
    line += str;
    // pdf.js adds its own spaces where there's a gap, so pieces of one line are simply joined.
    if (hasEOL) {
      lines.push(line);
      line = '';
    }
  }
  if (line.trim()) lines.push(line);
  return lines.map(tidy).filter(Boolean);
}

/** The words added, removed and moved between two versions of a page. */
export function textChanges(linesA: readonly string[], linesB: readonly string[]): TextChanges {
  const a = linesA.map(tidy).filter(Boolean);
  const b = linesB.map(tidy).filter(Boolean);
  const ops = diff(a, b);
  // A line removed in one place and added in another moved: it isn't counted as words removed and added.
  const removedLines = new Map<string, number>();
  for (const op of ops) if (op.kind === 'removed') removedLines.set(a[op.a], (removedLines.get(a[op.a]) ?? 0) + 1);
  const movedA = new Set<number>();
  const movedB = new Set<number>();
  const moved: string[] = [];
  for (const op of ops) {
    if (op.kind !== 'added' || !removedLines.get(b[op.b])) continue;
    removedLines.set(b[op.b], (removedLines.get(b[op.b]) as number) - 1);
    movedB.add(op.b);
    moved.push(b[op.b]);
  }
  const stillMoving = new Map<string, number>();
  for (const line of moved) stillMoving.set(line, (stillMoving.get(line) ?? 0) + 1);
  for (const op of ops) {
    if (op.kind !== 'removed' || !stillMoving.get(a[op.a])) continue;
    stillMoving.set(a[op.a], (stillMoving.get(a[op.a]) as number) - 1);
    movedA.add(op.a);
  }

  // The rest is compared word by word, a stretch of changed lines at a time.
  const removed: string[] = [];
  const added: string[] = [];
  let gapA: string[] = [];
  let gapB: string[] = [];
  const flush = () => {
    if (gapA.length || gapB.length) {
      const words = wordChanges(wordsOf(gapA), wordsOf(gapB));
      removed.push(...words.removed);
      added.push(...words.added);
    }
    gapA = [];
    gapB = [];
  };
  for (const op of ops) {
    if (op.kind === 'same') flush();
    else if (op.kind === 'removed') {
      if (!movedA.has(op.a)) gapA.push(a[op.a]);
    } else if (!movedB.has(op.b)) gapB.push(b[op.b]);
  }
  flush();
  return { removed, added, moved };
}

/** Runs of words removed and added between two lists of words. */
export function wordChanges(a: readonly string[], b: readonly string[]): { removed: string[]; added: string[] } {
  const removed: string[] = [];
  const added: string[] = [];
  // Removed and added words that sit together are listed as one run each, not split up.
  let runA: string[] = [];
  let runB: string[] = [];
  const endBoth = () => {
    if (runA.length) removed.push(runA.join(' '));
    if (runB.length) added.push(runB.join(' '));
    runA = [];
    runB = [];
  };
  for (const op of diff(a, b)) {
    if (op.kind === 'same') endBoth();
    else if (op.kind === 'removed') runA.push(a[op.a]);
    else runB.push(b[op.b]);
  }
  endBoth();
  return { removed, added };
}

// ---- Matching pages ----

export interface PageInfo {
  /** The page's words, counted. */
  counts: Map<string, number>;
  words: number;
  /** Its text, for spotting pages that are exactly the same. */
  key: string;
  /** For a page without text: a small picture of it. */
  print: Uint8Array | null;
}

export function pageInfo(lines: readonly string[], print: Uint8Array | null = null): PageInfo {
  const words = wordsOf(lines);
  const counts = new Map<string, number>();
  for (const w of words) counts.set(w, (counts.get(w) ?? 0) + 1);
  return { counts, words: words.length, key: words.length ? `text:${words.join(' ')}` : `picture:${print ? Array.from(print).join(',') : ''}`, print };
}

/** How alike two pages are, from 0 to 1: by their words, or for pages without text, by their pictures. */
export function similarity(a: PageInfo, b: PageInfo): number {
  if (a.words === 0 && b.words === 0) return a.print && b.print ? printSimilarity(a.print, b.print) : SAME_PAGE;
  if (a.words === 0 || b.words === 0) return 0;
  let both = 0;
  const [small, large] = a.counts.size <= b.counts.size ? [a.counts, b.counts] : [b.counts, a.counts];
  for (const [word, n] of small) both += Math.min(n, large.get(word) ?? 0);
  return both / (a.words + b.words - both);
}

/** A page as a small greyscale picture, PRINT_SIZE squares each way, for matching pages without text. */
export function fingerprint(p: Pixels): Uint8Array {
  const out = new Uint8Array(PRINT_SIZE * PRINT_SIZE);
  for (let cy = 0; cy < PRINT_SIZE; cy++) {
    for (let cx = 0; cx < PRINT_SIZE; cx++) {
      const x0 = Math.floor((cx * p.width) / PRINT_SIZE);
      const x1 = Math.max(x0 + 1, Math.floor(((cx + 1) * p.width) / PRINT_SIZE));
      const y0 = Math.floor((cy * p.height) / PRINT_SIZE);
      const y1 = Math.max(y0 + 1, Math.floor(((cy + 1) * p.height) / PRINT_SIZE));
      let sum = 0;
      let count = 0;
      for (let y = y0; y < y1 && y < p.height; y++) {
        for (let x = x0; x < x1 && x < p.width; x++) {
          const i = (y * p.width + x) * 4;
          sum += (p.data[i] * 299 + p.data[i + 1] * 587 + p.data[i + 2] * 114) / 1000;
          count++;
        }
      }
      out[cy * PRINT_SIZE + cx] = count ? Math.round(sum / count) : 255;
    }
  }
  return out;
}

/** The share of squares that look alike in two pages' small pictures. */
export function printSimilarity(a: Uint8Array, b: Uint8Array): number {
  let alike = 0;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) <= 24) alike++;
  return alike / a.length;
}

/**
 * Which page of the second version goes with which page of the first, in order. Pages with exactly
 * the same text are matched first; between them, pages are matched when at least SAME_PAGE alike,
 * as many and as well as possible. A page left over was removed (only `a`) or added (only `b`).
 */
export function alignPages(a: readonly PageInfo[], b: readonly PageInfo[]): { a: number | null; b: number | null }[] {
  const out: { a: number | null; b: number | null }[] = [];
  let gapA: number[] = [];
  let gapB: number[] = [];
  const flush = () => {
    out.push(...alignGap(a, b, gapA, gapB));
    gapA = [];
    gapB = [];
  };
  for (const op of diff(
    a.map((p) => p.key),
    b.map((p) => p.key),
  )) {
    if (op.kind === 'same') {
      flush();
      out.push({ a: op.a, b: op.b });
    } else if (op.kind === 'removed') gapA.push(op.a);
    else gapB.push(op.b);
  }
  flush();
  return out;
}

function alignGap(a: readonly PageInfo[], b: readonly PageInfo[], gapA: number[], gapB: number[]): { a: number | null; b: number | null }[] {
  const n = gapA.length;
  const m = gapB.length;
  if (n === 0 || m === 0) return [...gapA.map((i) => ({ a: i, b: null })), ...gapB.map((j) => ({ a: null, b: j }))];
  const sim = new Float64Array(n * m);
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) sim[i * m + j] = similarity(a[gapA[i]], b[gapB[j]]);
  const w = m + 1;
  const score = new Float64Array((n + 1) * w);
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const s = sim[(i - 1) * m + j - 1];
      score[i * w + j] = Math.max(score[(i - 1) * w + j], score[i * w + j - 1], s >= SAME_PAGE ? score[(i - 1) * w + j - 1] + s : -1);
    }
  }
  const pairs: { a: number | null; b: number | null }[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const s = i > 0 && j > 0 ? sim[(i - 1) * m + j - 1] : 0;
    if (i > 0 && j > 0 && s >= SAME_PAGE && score[i * w + j] === score[(i - 1) * w + j - 1] + s) {
      pairs.push({ a: gapA[--i], b: gapB[--j] });
    } else if (j > 0 && (i === 0 || score[i * w + j] === score[i * w + j - 1])) {
      pairs.push({ a: null, b: gapB[--j] });
    } else {
      pairs.push({ a: gapA[--i], b: null });
    }
  }
  return pairs.reverse();
}

// ---- Pixels ----

/**
 * Where two drawings of a page differ, as rectangles in pixels. Both are drawn at the same scale
 * from the top-left; where one is bigger, the other counts as white paper there. Nearby changes
 * are joined into one rectangle.
 */
export function changedRegions(a: Pixels, b: Pixels, cell = CELL): Rect[] {
  const width = Math.max(a.width, b.width);
  const height = Math.max(a.height, b.height);
  const cols = Math.ceil(width / cell);
  const rows = Math.ceil(height / cell);
  const changed = new Uint8Array(cols * rows);
  const at = (p: Pixels, x: number, y: number, c: number) => (x < p.width && y < p.height ? p.data[(y * p.width + x) * 4 + c] : 255);
  for (let y = 0; y < height; y++) {
    const row = Math.floor(y / cell) * cols;
    for (let x = 0; x < width; x++) {
      const square = row + Math.floor(x / cell);
      if (changed[square] >= 2) continue;
      for (let c = 0; c < 3; c++) {
        if (Math.abs(at(a, x, y, c) - at(b, x, y, c)) > PIXEL_CHANGE) {
          changed[square]++;
          break;
        }
      }
    }
  }
  // Squares with at least two changed pixels; groups of them, with gaps of a square or less, become one rectangle.
  const seen = new Uint8Array(cols * rows);
  const rects: Rect[] = [];
  for (let start = 0; start < changed.length; start++) {
    if (changed[start] < 2 || seen[start]) continue;
    let minX = cols;
    let minY = rows;
    let maxX = -1;
    let maxY = -1;
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const s = stack.pop() as number;
      const cx = s % cols;
      const cy = Math.floor(s / cols);
      minX = Math.min(minX, cx);
      maxX = Math.max(maxX, cx);
      minY = Math.min(minY, cy);
      maxY = Math.max(maxY, cy);
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const t = ny * cols + nx;
          if (changed[t] >= 2 && !seen[t]) {
            seen[t] = 1;
            stack.push(t);
          }
        }
      }
    }
    const x = Math.max(0, (minX - 1) * cell);
    const y = Math.max(0, (minY - 1) * cell);
    rects.push({ x, y, width: Math.min(width, (maxX + 2) * cell) - x, height: Math.min(height, (maxY + 2) * cell) - y });
  }
  return mergeOverlapping(rects);
}

function mergeOverlapping(rects: Rect[]): Rect[] {
  const out = [...rects];
  for (let merged = true; merged; ) {
    merged = false;
    outer: for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const p = out[i];
        const q = out[j];
        if (p.x <= q.x + q.width && q.x <= p.x + p.width && p.y <= q.y + q.height && q.y <= p.y + p.height) {
          const x = Math.min(p.x, q.x);
          const y = Math.min(p.y, q.y);
          out[i] = { x, y, width: Math.max(p.x + p.width, q.x + q.width) - x, height: Math.max(p.y + p.height, q.y + q.height) - y };
          out.splice(j, 1);
          merged = true;
          break outer;
        }
      }
    }
  }
  return out.sort((p, q) => p.y - q.y || p.x - q.x);
}

// ---- The whole comparison ----

export interface CompareOptions {
  /** Called as each page is read (every page of both versions), then as each pair is compared. */
  onProgress?: (stage: 'reading' | 'comparing', done: number, total: number) => void;
  /** Checked between pages; when it returns true, the comparison stops with a CompareStopped error. */
  stopped?: () => boolean;
}

export class CompareStopped extends Error {
  constructor() {
    super('The comparison was stopped.');
  }
}

const NO_CHANGES: TextChanges = { removed: [], added: [], moved: [] };

/** Compares two versions page by page. */
export async function compareDocuments(a: CompareSource, b: CompareSource, options: CompareOptions = {}): Promise<Comparison> {
  const progress = (stage: 'reading' | 'comparing', done: number, total: number) => {
    if (options.stopped?.()) throw new CompareStopped();
    options.onProgress?.(stage, done, total);
  };

  // Read every page's words; a page without any also gets a small picture, to match it by.
  const read = async (source: CompareSource, before: number) => {
    const lines: string[][] = [];
    const infos: PageInfo[] = [];
    for (let n = 1; n <= source.pages; n++) {
      const text = await source.lines(n);
      let print: Uint8Array | null = null;
      if (wordsOf(text).length === 0) {
        const size = await source.size(n);
        print = fingerprint(await source.draw(n, 64 / Math.max(1, size.width)));
      }
      lines.push(text);
      infos.push(pageInfo(text, print));
      progress('reading', before + n, a.pages + b.pages);
    }
    return { lines, infos };
  };
  const first = await read(a, 0);
  const second = await read(b, a.pages);
  const pairs = alignPages(first.infos, second.infos);

  const pages: PageComparison[] = [];
  let compared = 0;
  for (const pair of pairs) {
    if (pair.a === null || pair.b === null) {
      pages.push({ a: pair.a === null ? null : pair.a + 1, b: pair.b === null ? null : pair.b + 1, status: pair.a === null ? 'added' : 'removed', regions: [], text: NO_CHANGES });
    } else {
      const [sizeA, sizeB] = [await a.size(pair.a + 1), await b.size(pair.b + 1)];
      const scale = DRAW_WIDTH / Math.max(sizeA.width, sizeB.width, 1);
      const regions = changedRegions(await a.draw(pair.a + 1, scale), await b.draw(pair.b + 1, scale)).map((r) => ({
        x: r.x / scale,
        y: r.y / scale,
        width: r.width / scale,
        height: r.height / scale,
      }));
      const text = textChanges(first.lines[pair.a], second.lines[pair.b]);
      const same = regions.length === 0 && !text.removed.length && !text.added.length && !text.moved.length && sizeA.width === sizeB.width && sizeA.height === sizeB.height;
      pages.push({ a: pair.a + 1, b: pair.b + 1, status: same ? 'same' : 'changed', regions, text });
    }
    progress('comparing', ++compared, pairs.length);
  }
  const count = (status: PageComparison['status']) => pages.filter((p) => p.status === status).length;
  const result = { pages, same: count('same'), changed: count('changed'), added: count('added'), removed: count('removed') };
  return { ...result, identical: result.changed + result.added + result.removed === 0 };
}
