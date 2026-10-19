// Writes annotations added in ScribeForge as standard PDF annotations, each with its own
// appearance (how it looks), so every PDF reader shows the same thing.
import {
  beginMarkedContent,
  beginText,
  clip,
  closePath,
  endMarkedContent,
  endPath,
  endText,
  fill,
  lineTo,
  moveTo,
  moveText,
  PDFArray,
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
import { MARK_LINE_AT, markLineWidth } from './marks';
import type { AnnotationInput, Quad, RGB } from './types';

const N = (n: string) => PDFName.of(n);
type Pt = [number, number];

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
function drawable(text: string, supported: Set<number>): string {
  return [...text].map((ch) => (supported.has(ch.codePointAt(0) ?? 0) || ch === '\n' ? ch : '?')).join('');
}

function common(doc: PDFDocument, page: PDFPage, a: AnnotationInput, subtype: string, rect: number[], colour: RGB) {
  const ctx = doc.context;
  const now = new Date();
  const created = new Date(a.createdAt);
  const dict = ctx.obj({
    Type: 'Annot',
    Subtype: subtype,
    Rect: rect.map(round),
    F: 4, // print it
    C: colour,
    P: page.ref,
    NM: PDFString.of(`scribeforge-${a.id}`),
    M: PDFString.fromDate(now),
    CreationDate: PDFString.fromDate(Number.isNaN(created.getTime()) ? now : created),
  });
  if (a.author) dict.set(N('T'), PDFHexString.fromText(a.author));
  return dict;
}

function appearance(doc: PDFDocument, ops: PDFOperator[], bbox: number[], extra: Record<string, unknown> = {}): PDFRef {
  const stream = doc.context.formXObject(ops, { BBox: bbox.map(round), ...extra });
  return doc.context.register(stream);
}

function markup(doc: PDFDocument, page: PDFPage, a: Extract<AnnotationInput, { kind: 'highlight' | 'underline' | 'strikeout' }>): PDFRef {
  const points = a.quads.flat();
  const rect = boundsOf(points, 1);
  const subtype = a.kind === 'highlight' ? 'Highlight' : a.kind === 'underline' ? 'Underline' : 'StrikeOut';
  const dict = common(doc, page, a, subtype, rect, a.colour);
  dict.set(N('QuadPoints'), doc.context.obj(points.map(round)));
  if (a.comment) dict.set(N('Contents'), PDFHexString.fromText(a.comment));

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
  dict.set(N('AP'), doc.context.obj({ N: appearance(doc, ops, rect, { Resources: resources }) }));
  return doc.context.register(dict);
}

function note(doc: PDFDocument, page: PDFPage, a: Extract<AnnotationInput, { kind: 'note' }>): PDFRef {
  // Readers draw their own note icon; the comment is what matters.
  const dict = common(doc, page, a, 'Text', boundsOf(a.box), a.colour);
  dict.set(N('Name'), N('Note'));
  dict.set(N('Open'), doc.context.obj(false));
  dict.set(N('Contents'), PDFHexString.fromText(a.comment));
  return doc.context.register(dict);
}

function textBox(doc: PDFDocument, page: PDFPage, a: Extract<AnnotationInput, { kind: 'text' }>, font: PDFFont, helv: PDFRef): PDFRef {
  const { ul, ur, ll } = corners(a.box);
  const width = dist(ul, ur);
  const pad = 4;
  const size = a.fontSize;
  const leading = size * 1.2;
  const supported = new Set(font.getCharacterSet());
  const lines = wrapText(drawable(a.text, supported), font, size, Math.max(10, width - pad * 2));
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
  const angle = (a.rotation * Math.PI) / 180;
  const [c, s] = [Math.round(Math.cos(angle)), Math.round(Math.sin(angle))];
  const ap = appearance(doc, ops, [0, 0, width, height], {
    Matrix: [c, s, -s, c, 0, 0],
    Resources: { Font: { Helv: helv } },
  });
  dict.set(N('AP'), doc.context.obj({ N: ap }));
  return doc.context.register(dict);
}

/** Adds the annotations to the page. Returns how many were added. */
export async function addAnnotations(doc: PDFDocument, page: PDFPage, annotations: AnnotationInput[], fonts: { helvetica?: PDFFont }): Promise<number> {
  if (annotations.length === 0) return 0;
  const refs: PDFRef[] = [];
  for (const a of annotations) {
    if (a.kind === 'note') refs.push(note(doc, page, a));
    else if (a.kind === 'text') {
      fonts.helvetica ??= await doc.embedFont(StandardFonts.Helvetica);
      refs.push(textBox(doc, page, a, fonts.helvetica, fonts.helvetica.ref));
    } else refs.push(markup(doc, page, a));
  }
  const existing = page.node.lookupMaybe(N('Annots'), PDFArray);
  const all = existing ? [...existing.asArray(), ...refs] : refs;
  page.node.set(N('Annots'), doc.context.obj(all));
  return refs.length;
}
