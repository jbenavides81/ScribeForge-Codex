// Writes annotations added in ScribeForge as standard PDF annotations, each with its own
// appearance (how it looks), so every PDF reader shows the same thing.
import {
  appendBezierCurve,
  beginMarkedContent,
  beginText,
  clip,
  closePath,
  endMarkedContent,
  endPath,
  endText,
  fill,
  fillAndStroke,
  LineCapStyle,
  LineJoinStyle,
  lineTo,
  moveTo,
  moveText,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFString,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  setFillingRgbColor,
  setFontAndSize,
  setGraphicsState,
  setLineCap,
  setLineJoin,
  setLineWidth,
  setStrokingRgbColor,
  showText,
  StandardFonts,
  stroke,
  type PDFFont,
  type PDFOperator,
  type PDFPage,
  type PDFRef,
} from '@cantoo/pdf-lib';
import { arrowHead, MARK_LINE_AT, markLineWidth } from './marks';
import type { AnnotationInput, Pt, Quad, RGB, Rotation, StampKind } from './types';

const N = (n: string) => PDFName.of(n);

/** Marks an annotation to burn into its page when saving; the flatten step reads and removes it. */
export const FLATTEN_MARK = 'ScribeForgeFlatten';

const corners = (q: Quad): { ul: Pt; ur: Pt; ll: Pt; lr: Pt } => ({ ul: [q[0], q[1]], ur: [q[2], q[3]], ll: [q[4], q[5]], lr: [q[6], q[7]] });
const lerp = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function boundsOf(points: number[], pad = 0): [number, number, number, number] {
  const xs = points.filter((_, i) => i % 2 === 0);
  const ys = points.filter((_, i) => i % 2 === 1);
  return [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad];
}

const round = (n: number) => Math.round(n * 100) / 100;

/** Lines of text that fit `width` points, breaking at spaces (and inside words that don't fit). */
export function wrapText(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let line = '';
    for (const word of paragraph.split(' ')) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= width) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      line = '';
      // A word longer than the line is split across lines.
      let piece = '';
      for (const ch of word) {
        if (font.widthOfTextAtSize(piece + ch, size) > width && piece) {
          lines.push(piece);
          piece = '';
        }
        piece += ch;
      }
      line = piece;
    }
    lines.push(line);
  }
  return lines;
}

/** Text the standard Helvetica font can draw; anything it can't becomes "?". The full text is kept in the annotation. */
function drawable(text: string, font: PDFFont): string {
  const supported = new Set(font.getCharacterSet());
  return [...text].map((ch) => (supported.has(ch.codePointAt(0) ?? 0) || ch === '\n' ? ch : '?')).join('');
}

export interface Fonts {
  helvetica?: PDFFont;
  bold?: PDFFont;
}

async function fontsFor(doc: PDFDocument, a: AnnotationInput, fonts: Fonts): Promise<void> {
  if (a.kind === 'text' || a.kind === 'stamp') fonts.helvetica ??= await doc.embedFont(StandardFonts.Helvetica);
  if (a.kind === 'stamp') fonts.bold ??= await doc.embedFont(StandardFonts.HelveticaBold);
}

function common(doc: PDFDocument, page: PDFPage, a: AnnotationInput, subtype: string, rect: number[], colour: RGB | undefined): PDFDict {
  const ctx = doc.context;
  const now = new Date();
  const created = new Date(a.createdAt);
  const dict = ctx.obj({
    Type: 'Annot',
    Subtype: subtype,
    Rect: rect.map(round),
    F: 4, // print it
    P: page.ref,
    NM: PDFString.of(`scribeforge-${a.id}`),
    M: PDFString.fromDate(now),
    CreationDate: PDFString.fromDate(Number.isNaN(created.getTime()) ? now : created),
  });
  if (colour) dict.set(N('C'), ctx.obj(colour));
  if (a.author) dict.set(N('T'), PDFHexString.fromText(a.author));
  if ('comment' in a && a.comment) dict.set(N('Contents'), PDFHexString.fromText(a.comment));
  return dict;
}

function appearance(doc: PDFDocument, ops: PDFOperator[], bbox: number[], extra: Record<string, unknown> = {}): PDFRef {
  const stream = doc.context.formXObject(ops, { BBox: bbox.map(round), ...extra });
  return doc.context.register(stream);
}

function setAppearance(doc: PDFDocument, dict: PDFDict, ap: PDFRef): void {
  dict.set(N('AP'), doc.context.obj({ N: ap }));
}

/** The matrix that turns a box drawn upright into the page's own space, for a page turned `rotation`. */
function upright(rotation: Rotation): number[] {
  const angle = (rotation * Math.PI) / 180;
  const [c, s] = [Math.round(Math.cos(angle)), Math.round(Math.sin(angle))];
  return [c, s, -s, c, 0, 0];
}

function markup(doc: PDFDocument, page: PDFPage, a: Extract<AnnotationInput, { kind: 'highlight' | 'underline' | 'strikeout' }>): PDFDict {
  const points = a.quads.flat();
  const rect = boundsOf(points, 1);
  const subtype = a.kind === 'highlight' ? 'Highlight' : a.kind === 'underline' ? 'Underline' : 'StrikeOut';
  const dict = common(doc, page, a, subtype, rect, a.colour);
  dict.set(N('QuadPoints'), doc.context.obj(points.map(round)));

  const ops: PDFOperator[] = [pushGraphicsState()];
  const resources: Record<string, unknown> = {};
  if (a.kind === 'highlight') {
    // Multiply, so the text under the highlight stays dark.
    resources.ExtGState = { GS0: { Type: 'ExtGState', BM: 'Multiply' } };
    ops.push(setGraphicsState('GS0'), setFillingRgbColor(...a.colour));
    for (const q of a.quads) {
      const { ul, ur, ll, lr } = corners(q);
      ops.push(moveTo(...ul), lineTo(...ur), lineTo(...lr), lineTo(...ll), closePath(), fill());
    }
  } else {
    ops.push(setStrokingRgbColor(...a.colour));
    for (const q of a.quads) {
      const { ul, ur, ll, lr } = corners(q);
      const height = dist(ul, ll);
      ops.push(setLineWidth(round(markLineWidth(height))));
      const t = MARK_LINE_AT[a.kind];
      ops.push(moveTo(...lerp(ul, ll, t)), lineTo(...lerp(ur, lr, t)), stroke());
    }
  }
  ops.push(popGraphicsState());
  setAppearance(doc, dict, appearance(doc, ops, rect, { Resources: resources }));
  return dict;
}

/** A note: readers draw their own note icon unless it has to be burned into the page. */
function note(doc: PDFDocument, page: PDFPage, a: Extract<AnnotationInput, { kind: 'note' }>): PDFDict {
  const rect = boundsOf(a.box);
  const dict = common(doc, page, a, 'Text', rect, a.colour);
  dict.set(N('Name'), N('Note'));
  dict.set(N('Open'), doc.context.obj(false));
  if (a.flatten) setAppearance(doc, dict, noteAppearance(doc, rect, a.colour));
  return dict;
}

/**
 * ScribeForge's own note icon, used when a note is burned into the page (readers draw their
 * own icon otherwise, and a burned-in note has nothing left to draw it).
 */
export function noteAppearance(doc: PDFDocument, rect: number[], colour: RGB): PDFRef {
  const w = rect[2] - rect[0];
  const h = rect[3] - rect[1];
  const s = Math.min(w, h);
  const edge: RGB = [0.25, 0.25, 0.25];
  const ops: PDFOperator[] = [
    pushGraphicsState(),
    setLineWidth(round(Math.max(0.75, s / 24))),
    setFillingRgbColor(...colour),
    setStrokingRgbColor(...edge),
    // A sheet with a speech tail, then three lines of "writing".
    moveTo(round(s * 0.08), round(s * 0.3)),
    lineTo(round(s * 0.08), round(s * 0.92)),
    lineTo(round(s * 0.92), round(s * 0.92)),
    lineTo(round(s * 0.92), round(s * 0.3)),
    lineTo(round(s * 0.45), round(s * 0.3)),
    lineTo(round(s * 0.25), round(s * 0.08)),
    lineTo(round(s * 0.28), round(s * 0.3)),
    closePath(),
    fillAndStroke(),
  ];
  for (const y of [0.75, 0.6, 0.45]) ops.push(moveTo(round(s * 0.22), round(s * y)), lineTo(round(s * 0.78), round(s * y)), stroke());
  ops.push(popGraphicsState());
  return appearance(doc, ops, [0, 0, s, s]);
}

function textBox(doc: PDFDocument, page: PDFPage, a: Extract<AnnotationInput, { kind: 'text' }>, font: PDFFont): PDFDict {
  const { ul, ur, ll } = corners(a.box);
  const width = dist(ul, ur);
  const pad = 4;
  const size = a.fontSize;
  const leading = size * 1.2;
  const lines = wrapText(drawable(a.text, font), font, size, Math.max(10, width - pad * 2));
  const height = Math.max(dist(ul, ll), lines.length * leading + pad * 2);

  // The box as saved: same upper edge and width, height grown to fit the text.
  const down: Pt = [(ll[0] - ul[0]) / (dist(ul, ll) || 1), (ll[1] - ul[1]) / (dist(ul, ll) || 1)];
  const llNew: Pt = [ul[0] + down[0] * height, ul[1] + down[1] * height];
  const lrNew: Pt = [ur[0] + down[0] * height, ur[1] + down[1] * height];
  const rect = boundsOf([...ul, ...ur, ...llNew, ...lrNew]);

  const dict = common(doc, page, a, 'FreeText', rect, a.colour);
  dict.set(N('Contents'), PDFHexString.fromText(a.text));
  dict.set(N('DA'), PDFString.of(`/Helv ${size} Tf ${a.colour.join(' ')} rg`));
  dict.set(N('BS'), doc.context.obj({ W: 0 }));

  // Drawn upright in its own box, then turned to match the page's rotation.
  const ops: PDFOperator[] = [
    beginMarkedContent('Tx'),
    pushGraphicsState(),
    rectangle(0, 0, round(width), round(height)),
    clip(),
    endPath(),
    beginText(),
    setFontAndSize('Helv', size),
    setFillingRgbColor(...a.colour),
    moveText(pad, round(height - pad - size * 0.9)),
  ];
  lines.forEach((line, i) => {
    if (i > 0) ops.push(moveText(0, round(-leading)));
    if (line) ops.push(showText(font.encodeText(line)));
  });
  ops.push(endText(), popGraphicsState(), endMarkedContent());
  const ap = appearance(doc, ops, [0, 0, width, height], { Matrix: upright(a.rotation), Resources: { Font: { Helv: font.ref } } });
  setAppearance(doc, dict, ap);
  return dict;
}

/** Lines drawn with round ends and corners, as a pen would. */
const penStart = (colour: RGB, width: number): PDFOperator[] => [
  pushGraphicsState(),
  setStrokingRgbColor(...colour),
  setLineWidth(round(width)),
  setLineCap(LineCapStyle.Round),
  setLineJoin(LineJoinStyle.Round),
];

function ink(doc: PDFDocument, page: PDFPage, a: Extract<AnnotationInput, { kind: 'ink' }>): PDFDict {
  const paths = a.paths.filter((p) => p.length > 0);
  const rect = boundsOf(paths.flat(2), a.width);
  const dict = common(doc, page, a, 'Ink', rect, a.colour);
  dict.set(N('InkList'), doc.context.obj(paths.map((p) => p.flat().map(round))));
  dict.set(N('BS'), doc.context.obj({ W: round(a.width) }));
  const ops = penStart(a.colour, a.width);
  for (const path of paths) {
    ops.push(moveTo(...path[0]));
    // A single point is drawn as a dot.
    for (const p of path.length > 1 ? path.slice(1) : [path[0]]) ops.push(lineTo(...p));
    ops.push(stroke());
  }
  ops.push(popGraphicsState());
  setAppearance(doc, dict, appearance(doc, ops, rect));
  return dict;
}

/** Four Bézier curves around an ellipse (the usual 0.5523 approximation of a quarter circle). */
function ellipsePath(x0: number, y0: number, x1: number, y1: number): PDFOperator[] {
  const k = 0.5523;
  const [cx, cy, rx, ry] = [(x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2, (y1 - y0) / 2];
  const r = (n: number) => round(n);
  return [
    moveTo(r(cx + rx), r(cy)),
    appendBezierCurve(r(cx + rx), r(cy + ry * k), r(cx + rx * k), r(cy + ry), r(cx), r(cy + ry)),
    appendBezierCurve(r(cx - rx * k), r(cy + ry), r(cx - rx), r(cy + ry * k), r(cx - rx), r(cy)),
    appendBezierCurve(r(cx - rx), r(cy - ry * k), r(cx - rx * k), r(cy - ry), r(cx), r(cy - ry)),
    appendBezierCurve(r(cx + rx * k), r(cy - ry), r(cx + rx), r(cy - ry * k), r(cx + rx), r(cy)),
    closePath(),
  ];
}

function shape(doc: PDFDocument, page: PDFPage, a: Extract<AnnotationInput, { kind: 'rect' | 'ellipse' }>): PDFDict {
  // The shape's outline runs inside the box, so the box is exactly what's covered.
  const rect = boundsOf(a.box);
  const dict = common(doc, page, a, a.kind === 'rect' ? 'Square' : 'Circle', rect, a.colour);
  dict.set(N('BS'), doc.context.obj({ W: round(a.width) }));
  if (a.fill) dict.set(N('IC'), doc.context.obj(a.fill));
  const inset = a.width / 2;
  const [x0, y0, x1, y1] = [rect[0] + inset, rect[1] + inset, Math.max(rect[0] + inset, rect[2] - inset), Math.max(rect[1] + inset, rect[3] - inset)];
  const ops = penStart(a.colour, a.width);
  if (a.fill) ops.push(setFillingRgbColor(...a.fill));
  ops.push(...(a.kind === 'rect' ? [rectangle(round(x0), round(y0), round(x1 - x0), round(y1 - y0))] : ellipsePath(x0, y0, x1, y1)));
  ops.push(a.fill ? fillAndStroke() : stroke(), popGraphicsState());
  setAppearance(doc, dict, appearance(doc, ops, rect));
  return dict;
}

function line(doc: PDFDocument, page: PDFPage, a: Extract<AnnotationInput, { kind: 'line' | 'arrow' }>): PDFDict {
  const head = a.kind === 'arrow' ? arrowHead(a.from, a.to, a.width) : [];
  const rect = boundsOf([...a.from, ...a.to, ...head.flat()], a.width);
  const dict = common(doc, page, a, 'Line', rect, a.colour);
  dict.set(N('L'), doc.context.obj([...a.from, ...a.to].map(round)));
  dict.set(N('BS'), doc.context.obj({ W: round(a.width) }));
  dict.set(N('LE'), doc.context.obj([N('None'), N(a.kind === 'arrow' ? 'OpenArrow' : 'None')]));
  const ops = [...penStart(a.colour, a.width), moveTo(...a.from), lineTo(...a.to), stroke()];
  if (head.length > 0) ops.push(moveTo(...head[0]), lineTo(...a.to), lineTo(...head[1]), stroke());
  ops.push(popGraphicsState());
  setAppearance(doc, dict, appearance(doc, ops, rect));
  return dict;
}

/** The standard stamp names (ISO 32000-1, table 181), where one fits; readers fall back to the look drawn here. */
const STAMP_NAMES: Record<StampKind, string> = {
  approved: 'Approved',
  draft: 'Draft',
  confidential: 'Confidential',
  reviewed: 'ScribeForgeReviewed',
  'not-approved': 'NotApproved',
  custom: 'ScribeForgeCustom',
};

function stampAnnot(doc: PDFDocument, page: PDFPage, a: Extract<AnnotationInput, { kind: 'stamp' }>, regular: PDFFont, bold: PDFFont): PDFDict {
  const { ul, ur, ll } = corners(a.box);
  const width = dist(ul, ur);
  const height = dist(ul, ll);
  const rect = boundsOf(a.box);
  const dict = common(doc, page, a, 'Stamp', rect, a.colour);
  dict.set(N('Name'), N(STAMP_NAMES[a.stamp]));
  if (!a.comment) dict.set(N('Contents'), PDFHexString.fromText(`${a.label}, ${a.date}`));

  // Drawn upright in its own box: a rounded border, the label, and the date under it.
  const border = Math.max(1, Math.min(width, height) / 25);
  const label = drawable(a.label, bold);
  const date = drawable(a.date, regular);
  const labelSize = Math.max(4, Math.min(height * 0.42, (width - border * 6) / Math.max(1, bold.widthOfTextAtSize(label, 1))));
  const dateSize = Math.max(3, Math.min(height * 0.2, labelSize * 0.55, (width - border * 6) / Math.max(1, regular.widthOfTextAtSize(date, 1))));
  const r = Math.min(width, height) * 0.15;
  const [x0, y0, x1, y1] = [border, border, width - border, height - border];
  const k = 0.5523 * r;
  const ops: PDFOperator[] = [
    pushGraphicsState(),
    setStrokingRgbColor(...a.colour),
    setFillingRgbColor(...a.colour),
    setLineWidth(round(border)),
    moveTo(round(x0 + r), round(y0)),
    lineTo(round(x1 - r), round(y0)),
    appendBezierCurve(round(x1 - r + k), round(y0), round(x1), round(y0 + r - k), round(x1), round(y0 + r)),
    lineTo(round(x1), round(y1 - r)),
    appendBezierCurve(round(x1), round(y1 - r + k), round(x1 - r + k), round(y1), round(x1 - r), round(y1)),
    lineTo(round(x0 + r), round(y1)),
    appendBezierCurve(round(x0 + r - k), round(y1), round(x0), round(y1 - r + k), round(x0), round(y1 - r)),
    lineTo(round(x0), round(y0 + r)),
    appendBezierCurve(round(x0), round(y0 + r - k), round(x0 + r - k), round(y0), round(x0 + r), round(y0)),
    closePath(),
    stroke(),
    beginText(),
    setFontAndSize('HelvB', round(labelSize)),
    moveText(round((width - bold.widthOfTextAtSize(label, labelSize)) / 2), round(height * 0.5 + (dateSize * 0.3))),
    showText(bold.encodeText(label)),
    endText(),
    beginText(),
    setFontAndSize('Helv', round(dateSize)),
    moveText(round((width - regular.widthOfTextAtSize(date, dateSize)) / 2), round(height * 0.5 - dateSize * 1.35)),
    showText(regular.encodeText(date)),
    endText(),
    popGraphicsState(),
  ];
  const ap = appearance(doc, ops, [0, 0, width, height], {
    Matrix: upright(a.rotation),
    Resources: { Font: { Helv: regular.ref, HelvB: bold.ref } },
  });
  setAppearance(doc, dict, ap);
  return dict;
}

/** A reply: a comment pointing at the annotation it answers, where that annotation is. */
function reply(doc: PDFDocument, page: PDFPage, a: Extract<AnnotationInput, { kind: 'reply' }>, parent: PDFRef): PDFDict {
  const parentDict = doc.context.lookup(parent, PDFDict);
  const parentRect = parentDict.lookupMaybe(N('Rect'), PDFArray);
  const rect = parentRect ? parentRect.asArray().map((n) => Number(n.toString())) : [0, 0, 0, 0];
  const dict = common(doc, page, a, 'Text', rect, undefined);
  dict.set(N('IRT'), parent);
  dict.set(N('RT'), N('R'));
  dict.set(N('Name'), N('Comment'));
  dict.set(N('Open'), doc.context.obj(false));
  return dict;
}

/**
 * Builds one annotation as ScribeForge saves it (not yet added to a page). Used for new
 * annotations, and to redraw ones that were already in a file. Replies are made by
 * `addAnnotations`, which knows where their parents are.
 */
export async function buildAnnotation(doc: PDFDocument, page: PDFPage, a: Exclude<AnnotationInput, { kind: 'reply' }>, fonts: Fonts): Promise<PDFDict> {
  await fontsFor(doc, a, fonts);
  switch (a.kind) {
    case 'highlight':
    case 'underline':
    case 'strikeout':
      return markup(doc, page, a);
    case 'note':
      return note(doc, page, a);
    case 'text':
      return textBox(doc, page, a, fonts.helvetica as PDFFont);
    case 'ink':
      return ink(doc, page, a);
    case 'rect':
    case 'ellipse':
      return shape(doc, page, a);
    case 'line':
    case 'arrow':
      return line(doc, page, a);
    case 'stamp':
      return stampAnnot(doc, page, a, fonts.helvetica as PDFFont, fonts.bold as PDFFont);
  }
}

/**
 * Adds the annotations to the page. `added` maps ids of annotations added so far (on any page)
 * to where they are, and `inFile` the annotations that were already in the files (by
 * "source:id"), so replies can point at either. Returns how many were added.
 */
export async function addAnnotations(
  doc: PDFDocument,
  page: PDFPage,
  annotations: AnnotationInput[],
  fonts: Fonts,
  added: Map<string, PDFRef> = new Map(),
  inFile: Map<string, PDFRef> = new Map(),
): Promise<number> {
  if (annotations.length === 0) return 0;
  const refs: PDFRef[] = [];
  for (const a of annotations) {
    let dict: PDFDict;
    if (a.kind === 'reply') {
      const parent = a.replyTo.startsWith('file:') ? inFile.get(`${a.source}:${a.replyTo.slice(5)}`) : added.get(a.replyTo);
      if (!parent) continue; // its comment isn't in the new file
      dict = reply(doc, page, a, parent);
    } else dict = await buildAnnotation(doc, page, a, fonts);
    if (a.flatten) dict.set(N(FLATTEN_MARK), doc.context.obj(true));
    const ref = doc.context.register(dict);
    added.set(a.id, ref);
    refs.push(ref);
  }
  const existing = page.node.lookupMaybe(N('Annots'), PDFArray);
  const all = existing ? [...existing.asArray(), ...refs] : refs;
  page.node.set(N('Annots'), doc.context.obj(all));
  return refs.length;
}
