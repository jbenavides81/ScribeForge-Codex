// Where each letter of a page's text is, in the page's own space, worked out from pdf.js's
// drawing instructions the same way pdf.js positions letters when it draws them. Redaction boxes
// for search matches and selected text are built from these, so they cover the letters exactly:
// Phase 0 found that boxes placed by eye leave slivers of letters showing.
//
// Plain functions over a small part of pdf.js's page API, so the unit tests can run them in Node.
import type { Rect } from '../../../engine/types';

export interface Glyph {
  /** The letter (or letters, for a ligature); empty when the file doesn't say what it is. */
  text: string;
  /** The letter's box, from below its lowest point to above its highest, in page space. */
  rect: Rect;
}

/** The parts of pdf.js a page's letters are read with. */
export interface PdfApi {
  OPS: Record<string, number>;
  /** pdf.js's AnnotationMode.DISABLE: only the page's own content, without comments. */
  annotationsOff: number;
}

export interface GlyphPage {
  getOperatorList(params?: { annotationMode?: number }): Promise<{ fnArray: number[]; argsArray: unknown[] }>;
  commonObjs: { has(id: string): boolean; get(id: string): unknown };
}

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** `a` then `b` (PDF's row-vector order: a point is multiplied by a, then by b). */
function multiply(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[1] * b[2],
    a[0] * b[1] + a[1] * b[3],
    a[2] * b[0] + a[3] * b[2],
    a[2] * b[1] + a[3] * b[3],
    a[4] * b[0] + a[5] * b[2] + b[4],
    a[4] * b[1] + a[5] * b[3] + b[5],
  ];
}

const apply = (m: Matrix, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

const asMatrix = (value: unknown): Matrix | undefined => {
  const list = value && typeof value === 'object' && 'length' in value ? Array.from(value as ArrayLike<number>) : undefined;
  return list && list.length === 6 && list.every((n) => typeof n === 'number' && Number.isFinite(n)) ? (list as Matrix) : undefined;
};

interface FontInfo {
  /** Glyph space to text space (usually 1/1000). */
  scale: number;
  /** Highest and lowest point of any letter, as a fraction of the font size. */
  ascent: number;
  descent: number;
}

const DEFAULT_FONT: FontInfo = { scale: 0.001, ascent: 0.95, descent: -0.25 };

/** How tall a font's letters can be. Generous when the file doesn't say: better a box too big. */
function fontInfo(page: GlyphPage, name: unknown): FontInfo {
  if (typeof name !== 'string' || !page.commonObjs.has(name)) return DEFAULT_FONT;
  const font = page.commonObjs.get(name) as { fontMatrix?: number[]; bbox?: number[] } | undefined;
  const matrix = font?.fontMatrix && font.fontMatrix.length === 6 ? font.fontMatrix : undefined;
  const scale = matrix ? matrix[0] : DEFAULT_FONT.scale;
  const vertical = matrix ? matrix[3] : DEFAULT_FONT.scale;
  const box = font?.bbox && font.bbox.length === 4 && font.bbox.every(Number.isFinite) ? font.bbox : undefined;
  return {
    scale,
    ascent: box ? Math.max(DEFAULT_FONT.ascent, box[3] * vertical) : DEFAULT_FONT.ascent,
    descent: box ? Math.min(DEFAULT_FONT.descent, box[1] * vertical) : DEFAULT_FONT.descent,
  };
}

interface State {
  ctm: Matrix;
  font: FontInfo;
  size: number;
  charSpacing: number;
  wordSpacing: number;
  /** Horizontal scaling, 1 = 100%. */
  hScale: number;
  leading: number;
  rise: number;
}

/** Every letter on a page, with its box. Comments and form fields are left out. */
export async function pageGlyphs(page: GlyphPage, api: PdfApi): Promise<Glyph[]> {
  const { fnArray, argsArray } = await page.getOperatorList({ annotationMode: api.annotationsOff });
  const OPS = api.OPS;
  const glyphs: Glyph[] = [];
  let state: State = { ctm: IDENTITY, font: DEFAULT_FONT, size: 0, charSpacing: 0, wordSpacing: 0, hScale: 1, leading: 0, rise: 0 };
  const stack: State[] = [];
  let tm: Matrix = IDENTITY; // text matrix
  let tlm: Matrix = IDENTITY; // text line matrix

  const moveText = (tx: number, ty: number) => {
    tlm = multiply([1, 0, 0, 1, tx, ty], tlm);
    tm = tlm;
  };

  const show = (items: unknown) => {
    if (!Array.isArray(items)) return;
    const { font, size, charSpacing, wordSpacing, hScale, rise } = state;
    const toPage = multiply(tm, state.ctm);
    let x = 0;
    for (const item of items) {
      if (typeof item === 'number') {
        x -= (item * size) / 1000; // TJ's adjustments, in thousandths of the font size
        continue;
      }
      const glyph = item as { unicode?: string; width?: number; isSpace?: boolean } | null;
      if (!glyph) continue;
      const advance = (glyph.width ?? 0) * size * font.scale;
      const corners = [
        apply(toPage, x * hScale, rise + font.descent * size),
        apply(toPage, (x + advance) * hScale, rise + font.descent * size),
        apply(toPage, x * hScale, rise + font.ascent * size),
        apply(toPage, (x + advance) * hScale, rise + font.ascent * size),
      ];
      const xs = corners.map((c) => c[0]);
      const ys = corners.map((c) => c[1]);
      glyphs.push({ text: glyph.unicode ?? '', rect: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] });
      x += advance + charSpacing + (glyph.isSpace ? wordSpacing : 0);
    }
    tm = multiply([1, 0, 0, 1, x * hScale, 0], tm);
  };

  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    const args = (argsArray[i] ?? []) as unknown[];
    switch (fn) {
      case OPS.save:
        stack.push({ ...state });
        break;
      case OPS.restore:
        state = stack.pop() ?? state;
        break;
      case OPS.transform: {
        const m = asMatrix(args);
        if (m) state.ctm = multiply(m, state.ctm);
        break;
      }
      case OPS.paintFormXObjectBegin: {
        stack.push({ ...state });
        const m = asMatrix(args[0]);
        if (m) state.ctm = multiply(m, state.ctm);
        break;
      }
      case OPS.paintFormXObjectEnd:
        state = stack.pop() ?? state;
        break;
      case OPS.beginText:
        tm = IDENTITY;
        tlm = IDENTITY;
        break;
      case OPS.setFont:
        state.font = fontInfo(page, args[0]);
        state.size = Number(args[1]) || 0;
        break;
      case OPS.setGState:
        for (const entry of (args[0] as unknown[][] | undefined) ?? []) {
          if (Array.isArray(entry) && entry[0] === 'Font' && Array.isArray(entry[1])) {
            state.font = fontInfo(page, entry[1][0]);
            state.size = Number(entry[1][1]) || 0;
          }
        }
        break;
      case OPS.setTextMatrix: {
        const m = asMatrix(args) ?? asMatrix(args[0]);
        if (m) {
          tm = m;
          tlm = m;
        }
        break;
      }
      case OPS.moveText:
        moveText(Number(args[0]) || 0, Number(args[1]) || 0);
        break;
      case OPS.setLeadingMoveText:
        state.leading = -(Number(args[1]) || 0);
        moveText(Number(args[0]) || 0, Number(args[1]) || 0);
        break;
      case OPS.nextLine:
        moveText(0, -state.leading);
        break;
      case OPS.setLeading:
        state.leading = Number(args[0]) || 0;
        break;
      case OPS.setCharSpacing:
        state.charSpacing = Number(args[0]) || 0;
        break;
      case OPS.setWordSpacing:
        state.wordSpacing = Number(args[0]) || 0;
        break;
      case OPS.setHScale:
        state.hScale = (Number(args[0]) || 0) / 100;
        break;
      case OPS.setTextRise:
        state.rise = Number(args[0]) || 0;
        break;
      case OPS.showText:
      case OPS.showSpacedText:
        show(args[0]);
        break;
      case OPS.nextLineShowText:
        moveText(0, -state.leading);
        show(args[0]);
        break;
      case OPS.nextLineSetSpacingShowText:
        state.wordSpacing = Number(args[0]) || 0;
        state.charSpacing = Number(args[1]) || 0;
        moveText(0, -state.leading);
        show(args[2]);
        break;
      default:
        break;
    }
  }
  return glyphs;
}

/** Padding around every redaction box, in points (Phase 0 plan, section 9). */
export const PADDING = 1;

const normalise = (s: string) => s.normalize('NFKC').toLowerCase();

/** True when two letters sit on the same line, for text running in any of the four directions. */
function sameLine(a: Rect, b: Rect): boolean {
  const height = Math.min(a[3] - a[1], b[3] - b[1]);
  const width = Math.min(a[2] - a[0], b[2] - b[0]);
  const overlapY = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
  const overlapX = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
  const gapX = Math.max(a[0], b[0]) - Math.min(a[2], b[2]);
  const gapY = Math.max(a[1], b[1]) - Math.min(a[3], b[3]);
  return (overlapY > 0.5 * height && gapX < 2 * height) || (overlapX > 0.5 * width && gapY < 2 * width);
}

/** One padded box per line, covering the given letters (in the order they're drawn). */
export function lineBoxes(glyphs: Glyph[]): Rect[] {
  const boxes: Rect[] = [];
  let current: Rect | null = null;
  let last: Rect | null = null;
  for (const { rect } of glyphs) {
    if (rect[2] - rect[0] <= 0 && rect[3] - rect[1] <= 0) continue;
    if (current && last && sameLine(last, rect)) {
      current = [Math.min(current[0], rect[0]), Math.min(current[1], rect[1]), Math.max(current[2], rect[2]), Math.max(current[3], rect[3])];
    } else {
      if (current) boxes.push(current);
      current = [...rect] as Rect;
    }
    last = rect;
  }
  if (current) boxes.push(current);
  return boxes.map(([x0, y0, x1, y1]) => [x0 - PADDING, y0 - PADDING, x1 + PADDING, y1 + PADDING]);
}

/**
 * Every place a term appears on a page, as padded boxes (one per line it runs over). Matching
 * ignores capitals and spacing, so "John  Smith" and a name split across two lines are found.
 */
export function findTerm(glyphs: Glyph[], term: string): { text: string; boxes: Rect[] }[] {
  const needle = Array.from(normalise(term)).filter((c) => !/\s/u.test(c));
  if (needle.length === 0) return [];
  const chars: string[] = [];
  const owner: number[] = [];
  glyphs.forEach((g, i) => {
    for (const c of normalise(g.text)) {
      if (/\s/u.test(c)) continue;
      chars.push(c);
      owner.push(i);
    }
  });
  const found: { text: string; boxes: Rect[] }[] = [];
  for (let i = 0; i + needle.length <= chars.length; ) {
    let match = true;
    for (let k = 0; k < needle.length; k++) {
      if (chars[i + k] !== needle[k]) {
        match = false;
        break;
      }
    }
    if (!match) {
      i++;
      continue;
    }
    const covered = glyphs.slice(owner[i], owner[i + needle.length - 1] + 1);
    found.push({ text: covered.map((g) => g.text).join(''), boxes: lineBoxes(covered) });
    i += needle.length;
  }
  return found;
}

const squash = (s: string) => normalise(s).replace(/\s+/g, '');

/** A quick check of a page's text, so letter positions are only worked out for pages with a match. */
export async function pageMayContain(page: { getTextContent(): Promise<{ items: object[] }> }, term: string): Promise<boolean> {
  const content = await page.getTextContent();
  return squash(content.items.map((i) => ('str' in i ? String(i.str) : '')).join('')).includes(squash(term));
}

/** The letters whose middle lies inside any of the boxes (a text selection, in page space). */
export function glyphsIn(glyphs: Glyph[], boxes: Rect[]): Glyph[] {
  return glyphs.filter(({ rect }) => {
    const x = (rect[0] + rect[2]) / 2;
    const y = (rect[1] + rect[3]) / 2;
    return boxes.some((b) => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3]);
  });
}
