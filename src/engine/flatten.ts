// Burns annotations into their pages (Phase 2 plan, F5). Each annotation's own appearance is drawn
// onto the page exactly where it sits (ISO 32000-1, section 12.5.5), and the annotation is then
// removed, with its pop-up and any replies to it: what's left looks the same but is part of the
// page, so it can't be changed or removed.
import {
  concatTransformationMatrix,
  drawObject,
  PDFArray,
  PDFDict,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFStream,
  popGraphicsState,
  pushGraphicsState,
  type PDFDocument,
  type PDFObject,
  type PDFOperator,
  type PDFPage,
} from '@cantoo/pdf-lib';
import { FLATTEN_MARK, noteAppearance } from './annotate';
import { N, nameOf } from './objects';
import type { BuildReport, RGB } from './types';

/** The kinds of annotation that are comments or markings: what "flatten all" means. Not links or form fields. */
export const COMMENT_KINDS = new Set([
  'Text',
  'FreeText',
  'Line',
  'Square',
  'Circle',
  'Polygon',
  'PolyLine',
  'Highlight',
  'Underline',
  'Squiggly',
  'StrikeOut',
  'Stamp',
  'Caret',
  'Ink',
]);

const HIDDEN = 2;
const NO_VIEW = 32;

const numbers = (value: PDFObject | undefined): number[] | undefined =>
  value instanceof PDFArray ? value.asArray().map((n) => (n instanceof PDFNumber ? n.asNumber() : Number.NaN)) : undefined;

/** The annotation's normal appearance: a form drawn where it sits. */
function normalAppearance(doc: PDFDocument, annot: PDFDict): PDFRef | undefined {
  const ap = annot.lookupMaybe(N('AP'), PDFDict);
  const raw = ap?.get(N('N'));
  const normal = raw ? doc.context.lookup(raw) : undefined;
  if (normal instanceof PDFStream) return raw instanceof PDFRef ? raw : doc.context.register(normal);
  if (normal instanceof PDFDict) {
    // One appearance for each state (such as on and off); the annotation says which it's in.
    const state = annot.get(N('AS'));
    const chosen = state instanceof PDFName ? normal.get(state) : undefined;
    if (chosen instanceof PDFRef && doc.context.lookup(chosen) instanceof PDFStream) return chosen;
  }
  return undefined;
}

/** The matrix that puts a form's box (after its own matrix) onto the annotation's rectangle. */
export function placementMatrix(rect: number[], bbox: number[], matrix: number[]): number[] {
  const [a, b, c, d, e, f] = matrix;
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [x, y] of [
    [bbox[0], bbox[1]],
    [bbox[2], bbox[1]],
    [bbox[0], bbox[3]],
    [bbox[2], bbox[3]],
  ]) {
    xs.push(a * x + c * y + e);
    ys.push(b * x + d * y + f);
  }
  const [bx0, bx1, by0, by1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const [rx0, rx1, ry0, ry1] = [Math.min(rect[0], rect[2]), Math.max(rect[0], rect[2]), Math.min(rect[1], rect[3]), Math.max(rect[1], rect[3])];
  const sx = bx1 - bx0 > 0 ? (rx1 - rx0) / (bx1 - bx0) : 1;
  const sy = by1 - by0 > 0 ? (ry1 - ry0) / (by1 - by0) : 1;
  return [sx, 0, 0, sy, rx0 - bx0 * sx, ry0 - by0 * sy];
}

/**
 * Burns in the page's annotations that are marked for it, or every comment-type annotation when
 * `all` is set. Annotations with no look of their own are left as they are and counted.
 */
export function flattenPage(doc: PDFDocument, page: PDFPage, all: boolean, report: BuildReport): void {
  const annots = page.node.lookupMaybe(N('Annots'), PDFArray);
  if (!annots) return;
  const entries = annots.asArray().map((raw) => ({ raw, dict: doc.context.lookup(raw) }));
  const remove = new Set<PDFObject>();
  const ops: PDFOperator[] = [];

  for (const { raw, dict } of entries) {
    if (!(dict instanceof PDFDict)) continue;
    const subtype = nameOf(dict.get(N('Subtype'))) ?? '';
    const marked = dict.get(N(FLATTEN_MARK)) !== undefined;
    dict.delete(N(FLATTEN_MARK));
    if (!(marked || (all && COMMENT_KINDS.has(subtype)))) continue;
    // A reply has no look of its own: it goes with the annotation it answers.
    if (dict.has(N('IRT')) && !marked) continue;

    const flags = dict.lookupMaybe(N('F'), PDFNumber)?.asNumber() ?? 0;
    const rect = numbers(dict.get(N('Rect')));
    if (flags & (HIDDEN | NO_VIEW) || !rect) {
      // Not shown, so nothing to draw: it just goes.
      remove.add(raw);
      report.annotationsFlattened++;
      continue;
    }
    if (subtype === 'Text' && !dict.has(N('AP'))) {
      // Readers draw their own note icon; a burned-in note needs one drawn for it.
      const colour = numbers(dict.get(N('C')));
      const icon = noteAppearance(doc, rect, colour?.length === 3 ? (colour as RGB) : [1, 0.894, 0.361]);
      dict.set(N('AP'), doc.context.obj({ N: icon }));
    }
    const form = normalAppearance(doc, dict);
    const stream = form ? doc.context.lookup(form, PDFStream) : undefined;
    const bbox = numbers(stream?.dict.get(N('BBox')));
    if (!form || !stream || !bbox) {
      report.annotationsNotFlattened++;
      continue;
    }
    const matrix = numbers(stream.dict.get(N('Matrix'))) ?? [1, 0, 0, 1, 0, 0];
    const name = page.node.newXObject('SFAnnot', form);
    ops.push(pushGraphicsState(), concatTransformationMatrix(...(placementMatrix(rect, bbox, matrix) as [number, number, number, number, number, number])), drawObject(name), popGraphicsState());
    remove.add(raw);
    report.annotationsFlattened++;
  }
  if (remove.size === 0) return;

  // Pop-ups and replies of what was burned in go with it.
  const removedKeys = new Set([...remove].map(String));
  let grew = true;
  while (grew) {
    grew = false;
    for (const { raw, dict } of entries) {
      if (remove.has(raw) || !(dict instanceof PDFDict)) continue;
      const parent = dict.get(N('Parent')) ?? dict.get(N('IRT'));
      if (parent && removedKeys.has(String(parent))) {
        remove.add(raw);
        removedKeys.add(String(raw));
        grew = true;
      }
    }
  }
  page.node.set(N('Annots'), doc.context.obj(entries.filter((e) => !remove.has(e.raw)).map((e) => e.raw)));

  if (ops.length > 0) {
    // The page's own drawing is wrapped, so nothing it leaves changed can move what's drawn on top.
    const contents = page.node.get(N('Contents'));
    const list = contents ? doc.context.lookup(contents) : undefined;
    const streams = list instanceof PDFArray ? list.asArray() : contents ? [contents] : [];
    const start = doc.context.register(doc.context.contentStream([pushGraphicsState()]));
    const end = doc.context.register(doc.context.contentStream([popGraphicsState(), ...ops]));
    page.node.set(N('Contents'), doc.context.obj([start, ...streams, end]));
  }
}
