// Annotations added in ScribeForge, and changes to the ones already in the file, before they're
// saved: what they are, which one is selected, and undo/redo. Plain functions with no screen
// code, so the unit tests can check every change.
import { annotationColour, pdfColour } from '../../../shared/annotationColours';
import type { AnnotationInput, Pt, Quad, Rotation, StampKind } from '../../../engine/types';

export type AnnotKind =
  | 'highlight'
  | 'underline'
  | 'strikeout'
  | 'note'
  | 'text'
  | 'ink'
  | 'rect'
  | 'ellipse'
  | 'line'
  | 'arrow'
  | 'stamp'
  | 'reply';

export interface Annot {
  id: string;
  /** 0-based page of the open document. */
  page: number;
  kind: AnnotKind;
  colourId: string;
  /** Highlight, underline and strikeout: the marked text, one quad per line. */
  quads?: Quad[];
  /** Note, text box, rectangle, ellipse and stamp: the box as shown. */
  box?: Quad;
  /** Drawing: each stroke's points, in the page's own space. */
  paths?: Pt[][];
  /** Line and arrow: where it starts and ends (an arrow's head is at `to`). */
  from?: Pt;
  to?: Pt;
  /** Line thickness of drawings, shapes and lines, in points. */
  width?: number;
  /** Rectangle and ellipse: filled with the colour's light shade. */
  fill?: boolean;
  stamp?: StampKind;
  /** What a stamp says, and its date. */
  label?: string;
  date?: string;
  /** The comment (most kinds) or the box's text (text box). */
  text: string;
  fontSize?: number;
  /** The page's own rotation when the annotation was made. */
  rotation: Rotation;
  createdAt: string;
  /** A reply: what it answers (an annotation added here, or "file:<id>" for one in the file). */
  replyTo?: string;
  /** Burned into the page when saving. */
  flatten?: boolean;
}

/** A change to an annotation that was already in the file, by pdf.js's id for it. */
export interface FileEdit {
  deleted?: boolean;
  colourId?: string;
  text?: string;
  flatten?: boolean;
}

interface Snapshot {
  items: Annot[];
  edits: Record<string, FileEdit>;
}

export interface AnnotState extends Snapshot {
  /** The selected annotation: an id, or "file:<id>" for one already in the file. */
  selected: string | null;
  past: Snapshot[];
  future: Snapshot[];
  /** While typing in (or dragging) one annotation, the changes join one undo step. */
  typing: string | null;
  /** Burn every annotation into the pages when saving. */
  flattenAll: boolean;
}

/** Geometry and settings that can change after an annotation is made. */
export type AnnotChanges = Partial<Pick<Annot, 'colourId' | 'text' | 'fontSize' | 'width' | 'fill' | 'stamp' | 'label' | 'flatten' | 'quads' | 'box' | 'paths' | 'from' | 'to'>>;

export type AnnotAction =
  | { type: 'reset' }
  | { type: 'add'; annot: Annot; select?: boolean }
  /** `typing` (a key, such as the annotation's id or "drag-3") joins changes with the same key into one undo step. */
  | ({ type: 'update'; id: string; typing?: boolean | string } & AnnotChanges)
  | { type: 'remove'; id: string }
  | { type: 'select'; id: string | null }
  | ({ type: 'edit-file'; ref: string; typing?: boolean } & FileEdit)
  | { type: 'flatten-all'; on: boolean }
  | { type: 'undo' }
  | { type: 'redo' };

export const MAX_ANNOT_UNDO = 100;
/** Text size of a new text box, in points (as saved in the PDF). */
export const TEXT_BOX_POINTS = 12;
export const TEXT_SIZES = [10, 12, 14, 18, 24];
/** Line thicknesses, in points. */
export const LINE_WIDTHS: { value: number; label: string }[] = [
  { value: 1, label: 'Thin' },
  { value: 2, label: 'Medium' },
  { value: 4, label: 'Thick' },
];
export const DEFAULT_LINE_WIDTH = 2;

export const STAMPS: { id: StampKind; label: string; colourId: string }[] = [
  { id: 'approved', label: 'Approved', colourId: 'green' },
  { id: 'reviewed', label: 'Reviewed', colourId: 'blue' },
  { id: 'draft', label: 'Draft', colourId: 'blue' },
  { id: 'confidential', label: 'Confidential', colourId: 'red' },
  { id: 'not-approved', label: 'Not approved', colourId: 'red' },
  { id: 'custom', label: 'Your own text', colourId: 'blue' },
];

export const emptyAnnots: AnnotState = { items: [], edits: {}, selected: null, past: [], future: [], typing: null, flattenAll: false };

export function hasAnnotChanges(state: AnnotState): boolean {
  return state.past.length > 0 || state.flattenAll;
}

let counter = 0;
export function newAnnotId(): string {
  counter += 1;
  const random = Math.random().toString(36).slice(2, 10);
  return `${Date.now().toString(36)}-${counter}-${random}`;
}

/** Notes, text boxes, shapes, stamps and drawings can be moved and resized; text markings and replies can't. */
export const movable = (a: Annot): boolean => !['highlight', 'underline', 'strikeout', 'reply'].includes(a.kind);

function record(state: AnnotState, next: Snapshot, selected: string | null, typing: string | null = null): AnnotState {
  const past = [...state.past, { items: state.items, edits: state.edits }].slice(-MAX_ANNOT_UNDO);
  return { ...state, ...next, selected, past, future: [], typing };
}

/** Replies to an annotation, and replies to those. */
function repliesTo(items: Annot[], id: string): string[] {
  const out: string[] = [];
  for (const a of items) if (a.replyTo === id) out.push(a.id, ...repliesTo(items, a.id));
  return out;
}

export function annotReducer(state: AnnotState, action: AnnotAction): AnnotState {
  switch (action.type) {
    case 'reset':
      return emptyAnnots;

    case 'add':
      return record(state, { items: [...state.items, action.annot], edits: state.edits }, action.select === false ? state.selected : action.annot.id);

    case 'update': {
      const current = state.items.find((a) => a.id === action.id);
      if (!current) return state;
      const { type: _type, id: _id, typing, ...changes } = action;
      const next: Annot = { ...current, ...(Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined)) as AnnotChanges) };
      if (JSON.stringify(next) === JSON.stringify(current)) return state;
      const items = state.items.map((a) => (a.id === action.id ? next : a));
      const key = typing === true ? action.id : typing || null;
      // Keystrokes (or drag steps) with the same key replace the last step instead of adding one each.
      if (key && state.typing === key) return { ...state, items, future: [] };
      return record(state, { items, edits: state.edits }, state.selected, key);
    }

    case 'remove': {
      if (!state.items.some((a) => a.id === action.id)) return state;
      const gone = new Set([action.id, ...repliesTo(state.items, action.id)]);
      return record(
        state,
        { items: state.items.filter((a) => !gone.has(a.id)), edits: state.edits },
        state.selected && gone.has(state.selected) ? null : state.selected,
      );
    }

    case 'edit-file': {
      const { type: _type, ref, typing, ...change } = action;
      const current = state.edits[ref] ?? {};
      const next: FileEdit = { ...current, ...(Object.fromEntries(Object.entries(change).filter(([, v]) => v !== undefined)) as FileEdit) };
      if (JSON.stringify(next) === JSON.stringify(current)) return state;
      const edits = { ...state.edits, [ref]: next };
      // Deleting it also drops replies added here to it.
      const gone = next.deleted ? new Set(repliesTo(state.items, `file:${ref}`)) : new Set<string>();
      const items = gone.size > 0 ? state.items.filter((a) => !gone.has(a.id)) : state.items;
      const selected = next.deleted && state.selected === `file:${ref}` ? null : state.selected;
      const key = typing ? `file:${ref}` : null;
      if (key && state.typing === key) return { ...state, edits, items, future: [] };
      return record(state, { items, edits }, selected, key);
    }

    case 'flatten-all':
      return { ...state, flattenAll: action.on };

    case 'select':
      return { ...state, selected: action.id, typing: null };

    case 'undo': {
      if (state.past.length === 0) return state;
      const back = state.past[state.past.length - 1];
      return {
        ...state,
        ...back,
        selected: stillThere(back, state.selected) ? state.selected : null,
        past: state.past.slice(0, -1),
        future: [{ items: state.items, edits: state.edits }, ...state.future],
        typing: null,
      };
    }

    case 'redo': {
      if (state.future.length === 0) return state;
      const next = state.future[0];
      return {
        ...state,
        ...next,
        selected: stillThere(next, state.selected) ? state.selected : null,
        past: [...state.past, { items: state.items, edits: state.edits }],
        future: state.future.slice(1),
        typing: null,
      };
    }
  }
}

function stillThere(snapshot: Snapshot, selected: string | null): boolean {
  if (!selected) return false;
  if (selected.startsWith('file:')) return !snapshot.edits[selected.slice(5)]?.deleted;
  return snapshot.items.some((a) => a.id === selected);
}

/** Every point of an annotation's shape, in the page's own space. */
export function annotPoints(a: Annot): Pt[] {
  const fromQuad = (q: Quad): Pt[] => [
    [q[0], q[1]],
    [q[2], q[3]],
    [q[4], q[5]],
    [q[6], q[7]],
  ];
  if (a.box) return fromQuad(a.box);
  if (a.quads) return a.quads.flatMap(fromQuad);
  if (a.paths) return a.paths.flat();
  if (a.from && a.to) return [a.from, a.to];
  return [];
}

/** The annotation moved by (dx, dy) in the page's own space: the changes to apply. */
export function moved(a: Annot, dx: number, dy: number): AnnotChanges {
  const shift = (p: Pt): Pt => [p[0] + dx, p[1] + dy];
  const shiftQuad = (q: Quad): Quad => q.map((v, i) => (i % 2 === 0 ? v + dx : v + dy)) as Quad;
  if (a.box) return { box: shiftQuad(a.box) };
  if (a.paths) return { paths: a.paths.map((path) => path.map(shift)) };
  if (a.from && a.to) return { from: shift(a.from), to: shift(a.to) };
  return {};
}

/**
 * A drawing scaled to fill a new box: `from` and `to` are its old and new bounds in the page's
 * own space, as [x0, y0, x1, y1].
 */
export function scaledPaths(paths: Pt[][], from: number[], to: number[]): Pt[][] {
  const sx = from[2] - from[0] > 0.01 ? (to[2] - to[0]) / (from[2] - from[0]) : 1;
  const sy = from[3] - from[1] > 0.01 ? (to[3] - to[1]) / (from[3] - from[1]) : 1;
  return paths.map((path) => path.map(([x, y]) => [to[0] + (x - from[0]) * sx, to[1] + (y - from[1]) * sy] as Pt));
}

/**
 * What the engine saves. Highlights use the palette's light colour; underlines, strikeouts, text
 * boxes, drawings, shapes, lines and stamps its strong ink colour (shapes are filled with the
 * light one); notes the light colour (readers tint the note icon with it). Empty text boxes, and
 * stamps with no text, are not saved.
 */
export function toEngineInput(a: Annot, source: string, author: string): AnnotationInput | null {
  const colour = annotationColour(a.colourId);
  const ink = pdfColour(colour.ink);
  const common = { id: a.id, source, index: a.page, createdAt: a.createdAt, author: author || undefined, flatten: a.flatten || undefined };
  const comment = a.text || undefined;
  const width = a.width ?? DEFAULT_LINE_WIDTH;
  switch (a.kind) {
    case 'highlight':
      return { ...common, kind: 'highlight', quads: a.quads ?? [], colour: pdfColour(colour.highlight), comment };
    case 'underline':
    case 'strikeout':
      return { ...common, kind: a.kind, quads: a.quads ?? [], colour: ink, comment };
    case 'note':
      return { ...common, kind: 'note', box: a.box as Quad, colour: pdfColour(colour.highlight), comment: a.text };
    case 'text':
      if (a.text.trim() === '') return null;
      return { ...common, kind: 'text', box: a.box as Quad, text: a.text, colour: ink, fontSize: a.fontSize ?? TEXT_BOX_POINTS, rotation: a.rotation };
    case 'ink':
      return { ...common, kind: 'ink', paths: a.paths ?? [], colour: ink, width, comment };
    case 'rect':
    case 'ellipse':
      return { ...common, kind: a.kind, box: a.box as Quad, colour: ink, fill: a.fill ? pdfColour(colour.highlight) : undefined, width, comment };
    case 'line':
    case 'arrow':
      return { ...common, kind: a.kind, from: a.from as Pt, to: a.to as Pt, colour: ink, width, comment };
    case 'stamp':
      if (!a.label?.trim()) return null;
      return { ...common, kind: 'stamp', stamp: a.stamp ?? 'custom', label: a.label.trim(), date: a.date ?? '', box: a.box as Quad, colour: ink, rotation: a.rotation, comment };
    case 'reply':
      // An empty reply isn't saved.
      if (a.text.trim() === '' || !a.replyTo) return null;
      return { ...common, kind: 'reply', replyTo: a.replyTo, comment: a.text, flatten: undefined };
  }
}

/** What each kind is called on screen. */
export const ANNOT_NAMES: Record<AnnotKind, string> = {
  highlight: 'Highlight',
  underline: 'Underline',
  strikeout: 'Strikeout',
  note: 'Note',
  text: 'Text box',
  ink: 'Drawing',
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  line: 'Line',
  arrow: 'Arrow',
  stamp: 'Stamp',
  reply: 'Reply',
};
