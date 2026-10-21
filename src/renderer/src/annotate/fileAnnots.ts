// Annotations that were already in the file: read with pdf.js, named in plain words, and turned
// into what the engine needs to save a change to them. Plain functions over pdf.js's data, so the
// unit tests can check them.
import { ANNOTATION_COLOURS, annotationColour, pdfColour } from '../../../shared/annotationColours';
import type { AnnotationInput, FileAnnotationChange, Pt, Quad, Rotation } from '../../../engine/types';
import { DEFAULT_LINE_WIDTH, TEXT_BOX_POINTS, type Annot, type FileEdit } from './annotState';

/** An annotation in the file, as pdf.js reads it. */
export interface FileAnnot {
  /** pdf.js's id for it, such as "12R". */
  id: string;
  /** 0-based page. */
  page: number;
  subtype: string;
  rect: number[];
  /** Its colour, red, green and blue from 0 to 255 (none for some kinds). */
  colour: number[] | null;
  contents: string;
  author: string;
  /** When it was last changed (ISO date and time), or empty if the file doesn't say. */
  modified: string;
  /** A reply: pdf.js's id of the annotation it answers. */
  inReplyTo?: string;
  hidden: boolean;
  quadPoints?: number[];
  inkLists?: number[][];
  lineCoordinates?: number[];
  lineEndings?: string[];
  borderWidth?: number;
  fontSize?: number;
  /** The page's own rotation. */
  pageRotation: Rotation;
}

/** The kinds listed as comments; links, form fields and pop-ups aren't. */
const COMMENT_KINDS = new Set(['Text', 'FreeText', 'Line', 'Square', 'Circle', 'Polygon', 'PolyLine', 'Highlight', 'Underline', 'Squiggly', 'StrikeOut', 'Stamp', 'Caret', 'Ink', 'FileAttachment', 'Sound', 'Redact']);

export interface PdfAnnotationData {
  id: string;
  subtype: string;
  rect: number[];
  color?: ArrayLike<number> | null;
  contentsObj?: { str: string };
  titleObj?: { str: string };
  modificationDate?: string | null;
  inReplyTo?: string | null;
  replyType?: string;
  hidden?: boolean;
  quadPoints?: ArrayLike<number> | null;
  inkLists?: ArrayLike<number>[];
  lineCoordinates?: ArrayLike<number>;
  lineEndings?: string[];
  borderStyle?: { width?: number };
  defaultAppearanceData?: { fontSize?: number };
}

/** A PDF date ("D:20261021143000+02'00'") as an ISO date and time; empty if it can't be read. */
export function pdfDateToIso(text: string): string {
  const m = /^(?:D:)?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?([Zz+-])?(\d{2})?'?(\d{2})?/.exec(text.trim());
  if (!m) return '';
  const [, y, mo = '01', d = '01', h = '00', mi = '00', s = '00', zone, zh = '00', zm = '00'] = m;
  const offset = !zone || zone === 'Z' || zone === 'z' ? 'Z' : `${zone}${zh}:${zm}`;
  const date = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}${offset}`);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

/** The comment-type annotations of one page, from pdf.js's `getAnnotations()`. */
export function fileAnnotsOf(page: number, pageRotation: number, data: PdfAnnotationData[]): FileAnnot[] {
  return data
    .filter((a) => COMMENT_KINDS.has(a.subtype))
    .map((a) => ({
      id: a.id,
      page,
      subtype: a.subtype,
      rect: [...a.rect],
      colour: a.color ? Array.from(a.color) : null,
      contents: a.contentsObj?.str ?? '',
      author: a.titleObj?.str ?? '',
      modified: pdfDateToIso(a.modificationDate ?? ''),
      inReplyTo: a.inReplyTo && (a.replyType ?? 'R') === 'R' ? a.inReplyTo : undefined,
      hidden: a.hidden === true,
      quadPoints: a.quadPoints ? Array.from(a.quadPoints) : undefined,
      inkLists: a.inkLists?.map((l) => Array.from(l)),
      lineCoordinates: a.lineCoordinates ? Array.from(a.lineCoordinates) : undefined,
      lineEndings: a.lineEndings,
      borderWidth: a.borderStyle?.width,
      fontSize: a.defaultAppearanceData?.fontSize,
      pageRotation: (((pageRotation % 360) + 360) % 360) as Rotation,
    }));
}

/** A plain name for the kind of annotation. */
export function fileKindName(f: Pick<FileAnnot, 'subtype' | 'inReplyTo' | 'lineEndings'>): string {
  if (f.inReplyTo) return 'Reply';
  switch (f.subtype) {
    case 'Text':
      return 'Note';
    case 'FreeText':
      return 'Text box';
    case 'Highlight':
      return 'Highlight';
    case 'Underline':
      return 'Underline';
    case 'Squiggly':
      return 'Wavy underline';
    case 'StrikeOut':
      return 'Strikeout';
    case 'Ink':
      return 'Drawing';
    case 'Square':
      return 'Rectangle';
    case 'Circle':
      return 'Ellipse';
    case 'Line':
      return f.lineEndings?.some((e) => e !== 'None') ? 'Arrow' : 'Line';
    case 'Polygon':
    case 'PolyLine':
      return 'Shape';
    case 'Stamp':
      return 'Stamp';
    case 'Caret':
      return 'Insert mark';
    case 'FileAttachment':
      return 'Attached file';
    case 'Sound':
      return 'Sound';
    case 'Redact':
      return 'Redaction mark';
    default:
      return 'Comment';
  }
}

/**
 * ScribeForge can redraw these in a new colour (and text boxes with new text) from what pdf.js
 * reads. Others keep their own look: their comment can change, and they can be replied to,
 * deleted or burned in.
 */
export function canRedraw(f: FileAnnot): boolean {
  if (f.inReplyTo) return false;
  switch (f.subtype) {
    case 'Highlight':
    case 'Underline':
    case 'StrikeOut':
      return (f.quadPoints?.length ?? 0) >= 8;
    case 'Text':
      return true;
    case 'Ink':
      return (f.inkLists?.length ?? 0) > 0;
    case 'Line':
      return (f.lineCoordinates?.length ?? 0) === 4;
    case 'FreeText':
      return true;
    default:
      return false;
  }
}

/** The palette colour closest to the annotation's own, if one matches. */
export function paletteMatch(f: FileAnnot): string | undefined {
  if (!f.colour) return undefined;
  const near = (hex: string) => pdfColour(hex).every((v, i) => Math.abs(v * 255 - (f.colour as number[])[i]) <= 2);
  return ANNOTATION_COLOURS.find((c) => near(c.highlight) || near(c.ink))?.id;
}

const quadsOf = (points: number[]): Quad[] => Array.from({ length: Math.floor(points.length / 8) }, (_, i) => points.slice(i * 8, i * 8 + 8) as Quad);
const boxOf = ([x0, y0, x1, y1]: number[]): Quad => [x0, y1, x1, y1, x0, y0, x1, y0];
const pairs = (list: number[]): Pt[] => Array.from({ length: Math.floor(list.length / 2) }, (_, i) => [list[i * 2], list[i * 2 + 1]] as Pt);

/**
 * The annotation as ScribeForge would draw and save it, with a change applied: used to show a
 * changed annotation on screen, and to redraw it when saving. Undefined for kinds it can't redraw.
 */
export function asAnnot(f: FileAnnot, edit: FileEdit): Annot | undefined {
  if (!canRedraw(f)) return undefined;
  const colourId = edit.colourId ?? paletteMatch(f) ?? (f.subtype === 'Highlight' || f.subtype === 'Text' ? 'yellow' : 'red');
  const base = { id: `file:${f.id}`, page: f.page, colourId, text: edit.text ?? f.contents, rotation: f.pageRotation, createdAt: '' };
  switch (f.subtype) {
    case 'Highlight':
      return { ...base, kind: 'highlight', quads: quadsOf(f.quadPoints ?? []) };
    case 'Underline':
      return { ...base, kind: 'underline', quads: quadsOf(f.quadPoints ?? []) };
    case 'StrikeOut':
      return { ...base, kind: 'strikeout', quads: quadsOf(f.quadPoints ?? []) };
    case 'Text':
      return { ...base, kind: 'note', box: boxOf(f.rect) };
    case 'Ink':
      return { ...base, kind: 'ink', paths: (f.inkLists ?? []).map(pairs), width: f.borderWidth || DEFAULT_LINE_WIDTH };
    case 'Line': {
      const [x0, y0, x1, y1] = f.lineCoordinates ?? [0, 0, 0, 0];
      const arrow = f.lineEndings?.[1] !== undefined && f.lineEndings[1] !== 'None';
      return { ...base, kind: arrow ? 'arrow' : 'line', from: [x0, y0], to: [x1, y1], width: f.borderWidth || DEFAULT_LINE_WIDTH };
    }
    case 'FreeText':
      return { ...base, kind: 'text', box: boxOf(f.rect), fontSize: f.fontSize || TEXT_BOX_POINTS };
    default:
      return undefined;
  }
}

/** True when the change needs the annotation drawn again (not just its comment changed). */
export function needsRedraw(f: FileAnnot, edit: FileEdit): boolean {
  if (!canRedraw(f)) return false;
  return (edit.colourId !== undefined && edit.colourId !== paletteMatch(f)) || (f.subtype === 'FreeText' && edit.text !== undefined && edit.text !== f.contents);
}

/** What the engine needs to save the changes to the file's own annotations. */
export function fileChanges(files: FileAnnot[], edits: Record<string, FileEdit>, source: string, flattenAll: boolean): FileAnnotationChange[] {
  const out: FileAnnotationChange[] = [];
  for (const f of files) {
    const edit = edits[f.id];
    if (!edit) continue;
    if (edit.deleted) {
      out.push({ source, index: f.page, ref: f.id, deleted: true });
      continue;
    }
    const change: FileAnnotationChange = { source, index: f.page, ref: f.id };
    if (needsRedraw(f, edit)) {
      const annot = asAnnot(f, edit) as Annot;
      const colour = annotationColour(annot.colourId);
      const light = pdfColour(colour.highlight);
      const ink = pdfColour(colour.ink);
      const common = { id: f.id, source, index: f.page, createdAt: new Date().toISOString() };
      const redraw: AnnotationInput | undefined =
        annot.kind === 'highlight'
          ? { ...common, kind: 'highlight', quads: annot.quads ?? [], colour: light, comment: annot.text || undefined }
          : annot.kind === 'underline' || annot.kind === 'strikeout'
            ? { ...common, kind: annot.kind, quads: annot.quads ?? [], colour: ink, comment: annot.text || undefined }
            : annot.kind === 'note'
              ? { ...common, kind: 'note', box: annot.box as Quad, colour: light, comment: annot.text }
              : annot.kind === 'ink'
                ? { ...common, kind: 'ink', paths: annot.paths ?? [], colour: ink, width: annot.width ?? DEFAULT_LINE_WIDTH, comment: annot.text || undefined }
                : annot.kind === 'line' || annot.kind === 'arrow'
                  ? { ...common, kind: annot.kind, from: annot.from as Pt, to: annot.to as Pt, colour: ink, width: annot.width ?? DEFAULT_LINE_WIDTH, comment: annot.text || undefined }
                  : annot.kind === 'text'
                    ? { ...common, kind: 'text', box: annot.box as Quad, text: annot.text, colour: ink, fontSize: annot.fontSize ?? TEXT_BOX_POINTS, rotation: annot.rotation }
                    : undefined;
      if (redraw) change.redraw = redraw;
    }
    if (edit.text !== undefined && edit.text !== f.contents && f.subtype !== 'FreeText') change.comment = edit.text;
    if (edit.flatten && !flattenAll) change.flatten = true;
    if (change.redraw || change.comment !== undefined || change.flatten) out.push(change);
  }
  return out;
}

/** The file's annotations that ScribeForge should keep pdf.js from drawing: changed, deleted, or replies. */
export function hiddenFromViewer(files: FileAnnot[], edits: Record<string, FileEdit>): string[] {
  return files.filter((f) => f.inReplyTo || edits[f.id]?.deleted || (edits[f.id] && needsRedraw(f, edits[f.id]))).map((f) => f.id);
}
