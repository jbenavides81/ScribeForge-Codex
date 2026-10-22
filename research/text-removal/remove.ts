// RESEARCH PROTOTYPE (stop 2c), not part of the app: removes what's under redaction marks from a
// page's own drawing instructions, instead of turning the page into a picture.
//
// - Letters: each letter's position is worked out from the font's own widths (ISO 32000-1, 9.4.4);
//   letters under a mark are taken out of the strings, and a spacing number of the same width put
//   in their place, so every other letter stays exactly where it was.
// - Pictures: those stored uncompressed or with Flate (8 bits, grey or RGB) have the marked part of
//   the picture itself blacked out. Others (JPEG and so on) are reported.
// - Drawings: a path wholly inside a mark is removed; one that only crosses a mark is reported.
// - Forms (drawings reused between pages): copied for this page before they're changed, so other
//   pages keep theirs.
// - Marked content with ActualText or Alt (text kept for screen readers) loses those entries when
//   letters inside it are removed.
//
// Anything it can't handle is listed in `unsupported`: a real version would make that page a
// picture instead, as today. See docs/Research_TextRemoval.md.
import {
  decodePDFRawStream,
  PDFArray,
  PDFDict,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFStream,
  StandardFontEmbedder,
  StandardFonts,
  type PDFContext,
  type PDFDocument,
  type PDFObject,
} from '@cantoo/pdf-lib';
import { deflateSync, inflateSync } from 'node:zlib';
import { num, parseContent, writeContent, type Op, type Value } from '../../src/engine/content';

type M = [number, number, number, number, number, number];
type Rect = [number, number, number, number];
const I: M = [1, 0, 0, 1, 0, 0];
const N = (n: string) => PDFName.of(n);

const mul = (a: M, b: M): M => [
  a[0] * b[0] + a[1] * b[2],
  a[0] * b[1] + a[1] * b[3],
  a[2] * b[0] + a[3] * b[2],
  a[2] * b[1] + a[3] * b[3],
  a[4] * b[0] + a[5] * b[2] + b[4],
  a[4] * b[1] + a[5] * b[3] + b[5],
];
const apply = (m: M, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
function invert(m: M): M {
  const det = m[0] * m[3] - m[1] * m[2];
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
}
function boundsOf(m: M, x0: number, y0: number, x1: number, y1: number): Rect {
  const pts = [apply(m, x0, y0), apply(m, x1, y0), apply(m, x0, y1), apply(m, x1, y1)];
  return [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
}
const overlaps = (a: Rect, b: Rect) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
const inside = (a: Rect, b: Rect) => a[0] >= b[0] && a[1] >= b[1] && a[2] <= b[2] && a[3] <= b[3];

const nums = (o: PDFObject | undefined): number[] | undefined => (o instanceof PDFArray ? o.asArray().map((x) => (x instanceof PDFNumber ? x.asNumber() : 0)) : undefined);
const numOf = (o: PDFObject | undefined, fallback: number) => (o instanceof PDFNumber ? o.asNumber() : fallback);

/** What a font needs to place each letter: codes, widths (in text space per unit size) and height. */
interface FontInfo {
  bytesPerCode: 1 | 2;
  width(code: number): number;
  ascent: number;
  descent: number;
  simple: boolean;
  problem?: string;
}

const winAnsiNames = new Map<string, Map<number, string>>();
/** The library keeps these to itself; the prototype reads them anyway. */
type Measured = { encoding: { name: string; unicodeMappings: Record<string, [number, string]> }; widthOfGlyph(name: string): number; font: unknown };

function codeToGlyphName(embedder: Measured): Map<number, string> {
  const key = embedder.encoding.name;
  let map = winAnsiNames.get(key);
  if (!map) {
    map = new Map();
    for (const [code, name] of Object.values(embedder.encoding.unicodeMappings)) map.set(code, name);
    winAnsiNames.set(key, map);
  }
  return map;
}

export function fontInfo(context: PDFContext, font: PDFDict): FontInfo {
  const subtype = font.lookupMaybe(N('Subtype'), PDFName)?.decodeText();
  const descriptor = font.lookupMaybe(N('FontDescriptor'), PDFDict);
  const ascent = numOf(descriptor?.lookup(N('Ascent')), 950) / 1000;
  const descent = numOf(descriptor?.lookup(N('Descent')), -250) / 1000;

  if (subtype === 'Type0') {
    const encoding = font.lookupMaybe(N('Encoding'), PDFName)?.decodeText();
    if (encoding !== 'Identity-H') return { bytesPerCode: 2, width: () => 0, ascent, descent, simple: false, problem: `a font with the ${encoding ?? 'unknown'} encoding` };
    const descendant = font.lookup(N('DescendantFonts'), PDFArray).lookup(0, PDFDict);
    const dw = numOf(descendant.lookup(N('DW')), 1000);
    const widths = new Map<number, number>();
    const w = descendant.lookupMaybe(N('W'), PDFArray)?.asArray().map((x) => context.lookup(x)) ?? [];
    for (let k = 0; k < w.length; ) {
      const first = (w[k] as PDFNumber).asNumber();
      const next = w[k + 1];
      if (next instanceof PDFArray) {
        nums(next)?.forEach((v, j) => widths.set(first + j, v));
        k += 2;
      } else {
        const last = (next as PDFNumber).asNumber();
        const v = (w[k + 2] as PDFNumber).asNumber();
        for (let c = first; c <= last; c++) widths.set(c, v);
        k += 3;
      }
    }
    const d2 = descendant.lookupMaybe(N('FontDescriptor'), PDFDict);
    return {
      bytesPerCode: 2,
      width: (code) => (widths.get(code) ?? dw) / 1000,
      ascent: numOf(d2?.lookup(N('Ascent')), 950) / 1000,
      descent: numOf(d2?.lookup(N('Descent')), -250) / 1000,
      simple: false,
    };
  }

  const first = numOf(font.lookup(N('FirstChar')), 0);
  const widths = nums(font.lookupMaybe(N('Widths'), PDFArray));
  const missing = numOf(descriptor?.lookup(N('MissingWidth')), 0);

  if (subtype === 'Type3') {
    const matrix = nums(font.lookupMaybe(N('FontMatrix'), PDFArray)) ?? [0.001, 0, 0, 0.001, 0, 0];
    const bbox = nums(font.lookupMaybe(N('FontBBox'), PDFArray)) ?? [0, 0, 1000, 1000];
    return {
      bytesPerCode: 1,
      width: (code) => (widths?.[code - first] ?? 0) * matrix[0],
      ascent: bbox[3] * matrix[3],
      descent: bbox[1] * matrix[3],
      simple: true,
    };
  }

  if (widths) return { bytesPerCode: 1, width: (code) => (widths[code - first] ?? missing) / 1000, ascent, descent, simple: true };

  // One of the 14 standard fonts, which needn't list widths: the library's own measurements.
  const base = font.lookupMaybe(N('BaseFont'), PDFName)?.decodeText() ?? '';
  const standard = (Object.values(StandardFonts) as string[]).find((s) => s === base);
  if (!standard) return { bytesPerCode: 1, width: () => 0, ascent, descent, simple: true, problem: `a font with no widths (${base})` };
  const embedder = StandardFontEmbedder.for(standard as Parameters<typeof StandardFontEmbedder.for>[0]) as unknown as Measured;
  const names = codeToGlyphName(embedder);
  const metrics = embedder.font as unknown as { Ascender?: number; Descender?: number };
  return {
    bytesPerCode: 1,
    width: (code) => embedder.widthOfGlyph(names.get(code) ?? '.notdef') / 1000,
    ascent: (metrics.Ascender ?? 950) / 1000,
    descent: (metrics.Descender ?? -250) / 1000,
    simple: true,
  };
}

interface GState {
  ctm: M;
  font: FontInfo | null;
  size: number;
  tc: number;
  tw: number;
  th: number;
  tl: number;
  rise: number;
}

export interface RemovalResult {
  glyphs: number;
  images: number;
  drawings: number;
  unsupported: string[];
}

/** A stream's decoded bytes. */
function decoded(stream: PDFStream): Uint8Array {
  return stream instanceof PDFRawStream ? decodePDFRawStream(stream).decode() : (stream as unknown as { getContents(): Uint8Array }).getContents();
}

/**
 * Removes what's under `marks` from content drawn with `resources`, starting at `ctm`. Returns the
 * new operators, and XObjects to swap in the resources (copied ones, changed for this page only).
 */
function processContent(
  doc: PDFDocument,
  ops: Op[],
  resources: PDFDict | undefined,
  ctm: M,
  marks: Rect[],
  result: RemovalResult,
): { ops: Op[]; swaps: Map<string, PDFRef> } {
  const context = doc.context;
  const out: Op[] = [];
  const swaps = new Map<string, PDFRef>();
  let gs: GState = { ctm, font: null, size: 0, tc: 0, tw: 0, th: 1, tl: 0, rise: 0 };
  const stack: GState[] = [];
  let tm: M = I;
  let tlm: M = I;
  let path: Op[] = [];
  let pathBox: Rect | null = null;
  // Marked content that's open, so its ActualText can go when letters inside it are removed.
  const openMarks: { op: Op; touched: boolean }[] = [];
  const fonts = resources?.lookupMaybe(N('Font'), PDFDict);
  const xobjects = resources?.lookupMaybe(N('XObject'), PDFDict);
  const nameOf = (v: Value | undefined) => (v?.kind === 'name' ? v.value : '');
  const n = (v: Value | undefined) => (v?.kind === 'num' ? v.value : 0);

  const addPoint = (x: number, y: number) => {
    const [px, py] = apply(gs.ctm, x, y);
    pathBox = pathBox ? [Math.min(pathBox[0], px), Math.min(pathBox[1], py), Math.max(pathBox[2], px), Math.max(pathBox[3], py)] : [px, py, px, py];
  };

  /** Shows a string: returns the TJ items to draw in its place (unchanged if nothing is under a mark). */
  const show = (bytes: Uint8Array, items: Value[]) => {
    const font = gs.font;
    if (!font) {
      result.unsupported.push('text drawn without a font');
      return;
    }
    let chunk: number[] = [];
    let pending = 0;
    const flush = () => {
      if (chunk.length) items.push({ kind: 'str', bytes: new Uint8Array(chunk) });
      chunk = [];
    };
    const scale = gs.size * gs.th;
    for (let k = 0; k + font.bytesPerCode <= bytes.length; k += font.bytesPerCode) {
      const code = font.bytesPerCode === 2 ? (bytes[k] << 8) | bytes[k + 1] : bytes[k];
      const w0 = font.width(code);
      const trm = mul([gs.size * gs.th, 0, 0, gs.size, 0, gs.rise], mul(tm, gs.ctm));
      const box = boundsOf(trm, 0, font.descent, w0, font.ascent);
      const tx = (w0 * gs.size + gs.tc + (font.simple && code === 32 ? gs.tw : 0)) * gs.th;
      if (marks.some((m) => overlaps(box, m))) {
        if (font.problem) result.unsupported.push(`letters in ${font.problem}`);
        if (scale === 0) result.unsupported.push('text with no size');
        flush();
        pending += scale ? (-tx * 1000) / scale : 0;
        result.glyphs++;
        for (const m of openMarks) m.touched = true;
      } else {
        if (pending) {
          if (chunk.length) flush();
          items.push(num(pending));
          pending = 0;
        }
        for (let b = 0; b < font.bytesPerCode; b++) chunk.push(bytes[k + b]);
      }
      tm = mul([1, 0, 0, 1, tx, 0], tm);
    }
    flush();
    if (pending) items.push(num(pending));
  };

  const showOp = (strings: Value[]) => {
    const items: Value[] = [];
    const before = result.glyphs;
    for (const v of strings) {
      if (v.kind === 'str') show(v.bytes, items);
      else if (v.kind === 'num') {
        items.push(v);
        tm = mul([1, 0, 0, 1, (-v.value / 1000) * gs.size * gs.th, 0], tm);
      }
    }
    return result.glyphs === before ? null : items;
  };

  for (const o of ops) {
    const a = o.args;
    switch (o.op) {
      case 'q':
        stack.push({ ...gs });
        break;
      case 'Q':
        gs = stack.pop() ?? gs;
        break;
      case 'cm':
        gs.ctm = mul(a.map(n) as M, gs.ctm);
        break;
      case 'BT':
        tm = tlm = I;
        break;
      case 'Tf': {
        const font = fonts?.lookupMaybe(N(nameOf(a[0])), PDFDict);
        gs.font = font ? fontInfo(context, font) : null;
        gs.size = n(a[1]);
        break;
      }
      case 'Tc':
        gs.tc = n(a[0]);
        break;
      case 'Tw':
        gs.tw = n(a[0]);
        break;
      case 'Tz':
        gs.th = n(a[0]) / 100;
        break;
      case 'TL':
        gs.tl = n(a[0]);
        break;
      case 'Ts':
        gs.rise = n(a[0]);
        break;
      case 'Td':
      case 'TD':
        if (o.op === 'TD') gs.tl = -n(a[1]);
        tlm = mul([1, 0, 0, 1, n(a[0]), n(a[1])], tlm);
        tm = tlm;
        break;
      case 'Tm':
        tm = tlm = a.map(n) as M;
        break;
      case 'T*':
        tlm = mul([1, 0, 0, 1, 0, -gs.tl], tlm);
        tm = tlm;
        break;
      case 'BDC':
        openMarks.push({ op: o, touched: false });
        out.push(o);
        continue;
      case 'BMC':
        openMarks.push({ op: o, touched: false });
        out.push(o);
        continue;
      case 'EMC': {
        const closed = openMarks.pop();
        if (closed?.touched && closed.op.op === 'BDC') {
          const props = closed.op.args[1];
          if (props?.kind === 'dict') props.entries = props.entries.filter(([k]) => !['ActualText', 'Alt', 'E'].includes(k));
          else if (props?.kind === 'name') {
            // Layers keep their settings elsewhere too, but hold no text; text kept for screen readers would need its own copy.
            const named = resources?.lookupMaybe(N('Properties'), PDFDict)?.lookupMaybe(N(props.value), PDFDict);
            if (named && ['ActualText', 'Alt', 'E'].some((k) => named.has(N(k)))) result.unsupported.push('text for screen readers stored outside the page');
          }
        }
        out.push(o);
        continue;
      }
    }

    if (o.op === 'Tj' || o.op === "'" || o.op === '"') {
      if (o.op === "'" || o.op === '"') {
        if (o.op === '"') {
          gs.tw = n(a[0]);
          gs.tc = n(a[1]);
          out.push({ op: 'Tw', args: [a[0]] }, { op: 'Tc', args: [a[1]] });
        }
        tlm = mul([1, 0, 0, 1, 0, -gs.tl], tlm);
        tm = tlm;
        out.push({ op: 'T*', args: [] });
      }
      const items = showOp([a[a.length - 1]]);
      out.push(items ? { op: 'TJ', args: [{ kind: 'arr', items }] } : { op: 'Tj', args: [a[a.length - 1]] });
      continue;
    }
    if (o.op === 'TJ') {
      const items = a[0]?.kind === 'arr' ? showOp(a[0].items) : null;
      out.push(items ? { op: 'TJ', args: [{ kind: 'arr', items }] } : o);
      continue;
    }

    // Drawings: kept back until they're painted, then kept, removed, or reported.
    if (['m', 'l', 'c', 'v', 'y', 'h', 're', 'W', 'W*'].includes(o.op)) {
      if (o.op === 're') {
        addPoint(n(a[0]), n(a[1]));
        addPoint(n(a[0]) + n(a[2]), n(a[1]) + n(a[3]));
      } else for (let k = 0; k + 1 < a.length; k += 2) addPoint(n(a[k]), n(a[k + 1]));
      path.push(o);
      continue;
    }
    if (['S', 's', 'f', 'F', 'f*', 'B', 'B*', 'b', 'b*', 'n'].includes(o.op)) {
      const box = pathBox;
      const hit = box && o.op !== 'n' && marks.some((m) => overlaps(box, m));
      if (hit && box && marks.some((m) => inside(box, m))) {
        result.drawings++;
      } else {
        if (hit) result.unsupported.push('a drawing that crosses the edge of a mark');
        out.push(...path, o);
      }
      path = [];
      pathBox = null;
      continue;
    }
    if (o.op === 'sh') {
      result.unsupported.push('a shading (colour blend), which may run under a mark');
      out.push(o);
      continue;
    }
    if (o.op === 'BI') {
      if (marks.some((m) => overlaps(boundsOf(gs.ctm, 0, 0, 1, 1), m))) result.unsupported.push('a picture stored in the page itself (inline image)');
      out.push(o);
      continue;
    }

    if (o.op === 'Do') {
      const name = nameOf(a[0]);
      const ref = xobjects?.get(N(name));
      const xobject = ref ? context.lookup(ref) : undefined;
      if (!(xobject instanceof PDFStream)) {
        out.push(o);
        continue;
      }
      const subtype = xobject.dict.lookupMaybe(N('Subtype'), PDFName)?.decodeText();
      if (subtype === 'Form') {
        const matrix = (nums(xobject.dict.lookupMaybe(N('Matrix'), PDFArray)) ?? I) as M;
        const bbox = nums(xobject.dict.lookupMaybe(N('BBox'), PDFArray)) ?? [0, 0, 0, 0];
        const formCtm = mul(matrix, gs.ctm);
        if (marks.some((m) => overlaps(boundsOf(formCtm, bbox[0], bbox[1], bbox[2], bbox[3]), m))) {
          const before = result.glyphs + result.images + result.drawings;
          const formResources = xobject.dict.lookupMaybe(N('Resources'), PDFDict) ?? resources;
          const inner = processContent(doc, parseContent(decoded(xobject)), formResources, formCtm, marks, result);
          if (result.glyphs + result.images + result.drawings > before) {
            // A copy of the form for this page: other pages that use it keep the original.
            const copy = context.flateStream(writeContent(inner.ops));
            for (const [key, value] of xobject.dict.entries()) {
              if (!['Length', 'Filter', 'DecodeParms', 'Resources'].includes(key.decodeText())) copy.dict.set(key, value);
            }
            if (formResources) copy.dict.set(N('Resources'), withSwaps(context, formResources, inner.swaps));
            swaps.set(name, context.register(copy));
          }
        }
      } else if (subtype === 'Image') {
        const box = boundsOf(gs.ctm, 0, 0, 1, 1);
        const under = marks.filter((m) => overlaps(box, m));
        if (under.length > 0) {
          const blacked = blackOutImage(context, xobject, invert(gs.ctm), under);
          if (typeof blacked === 'string') result.unsupported.push(blacked);
          else {
            swaps.set(name, blacked);
            result.images++;
          }
        }
      }
      out.push(o);
      continue;
    }
    out.push(o);
  }
  return { ops: out, swaps };
}

/** A copy of a resources dictionary with some XObjects swapped for this page's copies. */
function withSwaps(context: PDFContext, resources: PDFDict, swaps: Map<string, PDFRef>): PDFDict {
  const copy = resources.clone(context);
  if (swaps.size === 0) return copy;
  const xobjects = (resources.lookupMaybe(N('XObject'), PDFDict) ?? context.obj({})).clone(context);
  for (const [name, ref] of swaps) xobjects.set(N(name), ref);
  copy.set(N('XObject'), xobjects);
  return copy;
}

/** Blacks out the marked part of a picture itself, as a new copy; or why it can't. */
function blackOutImage(context: PDFContext, image: PDFStream, toImage: M, marks: Rect[]): PDFRef | string {
  const d = image.dict;
  const filter = d.lookupMaybe(N('Filter'), PDFName)?.decodeText();
  const bits = numOf(d.lookup(N('BitsPerComponent')), 8);
  const space = d.lookupMaybe(N('ColorSpace'), PDFName)?.decodeText();
  if (filter && filter !== 'FlateDecode') return `a picture stored as ${filter === 'DCTDecode' ? 'JPEG' : filter}`;
  if (d.has(N('DecodeParms'))) return 'a picture stored with a predictor';
  if (bits !== 8 || (space !== 'DeviceRGB' && space !== 'DeviceGray')) return 'a picture in a colour format the prototype doesn’t read';
  const width = numOf(d.lookup(N('Width')), 0);
  const height = numOf(d.lookup(N('Height')), 0);
  const channels = space === 'DeviceRGB' ? 3 : 1;
  const raw = image instanceof PDFRawStream ? image.getContents() : new Uint8Array();
  const pixels = new Uint8Array(filter ? inflateSync(raw) : raw);
  for (const m of marks) {
    // The mark in the picture's own square (0 to 1), then in its pixels (row 0 at the top).
    const [u0, v0, u1, v1] = boundsOf(toImage, m[0], m[1], m[2], m[3]);
    const x0 = Math.max(0, Math.floor(u0 * width));
    const x1 = Math.min(width, Math.ceil(u1 * width));
    const y0 = Math.max(0, Math.floor((1 - v1) * height));
    const y1 = Math.min(height, Math.ceil((1 - v0) * height));
    for (let y = y0; y < y1; y++) pixels.fill(0, (y * width + x0) * channels, (y * width + x1) * channels);
  }
  const copy = context.stream(deflateSync(pixels), {});
  for (const [key, value] of d.entries()) if (!['Length', 'Filter', 'DecodeParms'].includes(key.decodeText())) copy.dict.set(key, value);
  copy.dict.set(N('Filter'), N('FlateDecode'));
  return context.register(copy);
}

/**
 * Removes what's under the marks (rectangles in the page's own space) from one page, then draws a
 * black box over each mark. The page's other content is left exactly as it was.
 */
export function removeUnderMarks(doc: PDFDocument, pageIndex: number, marks: Rect[]): RemovalResult {
  const page = doc.getPage(pageIndex);
  const context = doc.context;
  const result: RemovalResult = { glyphs: 0, images: 0, drawings: 0, unsupported: [] };
  const contents = page.node.Contents();
  const streams = contents instanceof PDFArray ? contents.asArray().map((r) => context.lookup(r) as PDFStream) : contents ? [contents as PDFStream] : [];
  const parts = streams.map(decoded);
  const all = new Uint8Array(parts.reduce((s, p) => s + p.length + 1, 0));
  let at = 0;
  for (const p of parts) {
    all.set(p, at);
    all[at + p.length] = 10;
    at += p.length + 1;
  }
  const resources = page.node.Resources();
  const { ops, swaps } = processContent(doc, parseContent(all), resources, I, marks, result);
  const boxes: Op[] = marks.flatMap((m) => [
    { op: 'q', args: [] },
    { op: 'rg', args: [num(0), num(0), num(0)] },
    { op: 're', args: [num(m[0]), num(m[1]), num(m[2] - m[0]), num(m[3] - m[1])] },
    { op: 'f', args: [] },
    { op: 'Q', args: [] },
  ]);
  const content = context.flateStream(writeContent([{ op: 'q', args: [] }, ...ops, { op: 'Q', args: [] }, ...boxes]));
  page.node.set(N('Contents'), context.register(content));
  if (resources) page.node.set(N('Resources'), withSwaps(context, resources, swaps));
  return { ...result, unsupported: [...new Set(result.unsupported)] };
}
