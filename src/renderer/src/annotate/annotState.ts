// Annotations added in ScribeForge, before they're saved: what they are, which one is selected,
// and undo/redo. Plain functions with no screen code, so the unit tests can check every change.
import { annotationColour, pdfColour } from '../../../shared/annotationColours';
import type { AnnotationInput, Quad, Rotation } from '../../../engine/types';

export type AnnotKind = 'highlight' | 'underline' | 'strikeout' | 'note' | 'text';

export interface Annot {
  id: string;
  /** 0-based page of the open document. */
  page: number;
  kind: AnnotKind;
  colourId: string;
  /** Highlight, underline and strikeout: the marked text, one quad per line. */
  quads?: Quad[];
  /** Note and text box: the box as shown. */
  box?: Quad;
  /** The comment (highlight, underline, strikeout, note) or the box's text. */
  text: string;
  fontSize?: number;
  /** The page's own rotation when the annotation was made. */
  rotation: Rotation;
  createdAt: string;
}

export interface AnnotState {
  items: Annot[];
  selected: string | null;
  past: Annot[][];
  future: Annot[][];
  /** While typing in one annotation, keystrokes join one undo step. */
  typing: string | null;
}

export type AnnotAction =
  | { type: 'reset' }
  | { type: 'add'; annot: Annot }
  | { type: 'update'; id: string; colourId?: string; text?: string; typing?: boolean }
  | { type: 'remove'; id: string }
  | { type: 'select'; id: string | null }
  | { type: 'undo' }
  | { type: 'redo' };

export const MAX_ANNOT_UNDO = 100;
/** Text size of a new text box, in points (as saved in the PDF). */
export const TEXT_BOX_POINTS = 12;

export const emptyAnnots: AnnotState = { items: [], selected: null, past: [], future: [], typing: null };

export function hasAnnotChanges(state: AnnotState): boolean {
  return state.past.length > 0;
}

let counter = 0;
export function newAnnotId(): string {
  counter += 1;
  const random = Math.random().toString(36).slice(2, 10);
  return `${Date.now().toString(36)}-${counter}-${random}`;
}

function record(state: AnnotState, items: Annot[], selected: string | null, typing: string | null = null): AnnotState {
  return { items, selected, past: [...state.past, state.items].slice(-MAX_ANNOT_UNDO), future: [], typing };
}

export function annotReducer(state: AnnotState, action: AnnotAction): AnnotState {
  switch (action.type) {
    case 'reset':
      return emptyAnnots;

    case 'add':
      return record(state, [...state.items, action.annot], action.annot.id);

    case 'update': {
      const current = state.items.find((a) => a.id === action.id);
      if (!current) return state;
      const next: Annot = { ...current };
      if (action.colourId !== undefined) next.colourId = action.colourId;
      if (action.text !== undefined) next.text = action.text;
      if (next.colourId === current.colourId && next.text === current.text) return state;
      const items = state.items.map((a) => (a.id === action.id ? next : a));
      // Keystrokes in the same annotation replace the last step instead of adding one each.
      if (action.typing && state.typing === action.id) return { ...state, items, future: [] };
      return record(state, items, state.selected, action.typing ? action.id : null);
    }

    case 'remove': {
      if (!state.items.some((a) => a.id === action.id)) return state;
      return record(
        state,
        state.items.filter((a) => a.id !== action.id),
        state.selected === action.id ? null : state.selected,
      );
    }

    case 'select':
      return { ...state, selected: action.id, typing: null };

    case 'undo': {
      if (state.past.length === 0) return state;
      const items = state.past[state.past.length - 1];
      return {
        items,
        selected: items.some((a) => a.id === state.selected) ? state.selected : null,
        past: state.past.slice(0, -1),
        future: [state.items, ...state.future],
        typing: null,
      };
    }

    case 'redo': {
      if (state.future.length === 0) return state;
      const items = state.future[0];
      return {
        items,
        selected: items.some((a) => a.id === state.selected) ? state.selected : null,
        past: [...state.past, state.items],
        future: state.future.slice(1),
        typing: null,
      };
    }
  }
}

/**
 * What the engine saves. Highlights use the palette's light colour; underlines, strikeouts and
 * text boxes its strong ink colour; notes the light colour (readers tint the note icon with it).
 * Empty text boxes are not saved.
 */
export function toEngineInput(a: Annot, source: string, author: string): AnnotationInput | null {
  const colour = annotationColour(a.colourId);
  const common = { id: a.id, source, index: a.page, createdAt: a.createdAt, author: author || undefined };
  switch (a.kind) {
    case 'highlight':
      return { ...common, kind: 'highlight', quads: a.quads ?? [], colour: pdfColour(colour.highlight), comment: a.text || undefined };
    case 'underline':
    case 'strikeout':
      return { ...common, kind: a.kind, quads: a.quads ?? [], colour: pdfColour(colour.ink), comment: a.text || undefined };
    case 'note':
      return { ...common, kind: 'note', box: a.box as Quad, colour: pdfColour(colour.highlight), comment: a.text };
    case 'text':
      if (a.text.trim() === '') return null;
      return { ...common, kind: 'text', box: a.box as Quad, text: a.text, colour: pdfColour(colour.ink), fontSize: a.fontSize ?? TEXT_BOX_POINTS, rotation: a.rotation };
  }
}
