// Redaction marks made on the Document screen, before they're applied: what they are, which one
// is selected, and undo/redo. Plain functions with no screen code, so the unit tests can check
// every change.
import type { Rect } from '../../../engine/types';

export interface RedactMark {
  id: string;
  /** 0-based page of the open document. */
  page: number;
  /** Drawn by hand, made from selected text, or one match of a search. */
  kind: 'area' | 'text' | 'search';
  /** The boxes to black out, in page space. */
  rects: Rect[];
  /** The text it covers (for text and search marks). */
  text?: string;
  /** Search marks: the search that made it, and how many marks that search made in all. */
  term?: string;
  group?: string;
  groupSize?: number;
}

export interface RedactState {
  marks: RedactMark[];
  selected: string | null;
  past: RedactMark[][];
  future: RedactMark[][];
}

export type RedactAction =
  | { type: 'reset' }
  | { type: 'add'; marks: RedactMark[] }
  | { type: 'remove'; ids: string[] }
  | { type: 'select'; id: string | null }
  | { type: 'undo' }
  | { type: 'redo' };

export const MAX_REDACT_UNDO = 100;
export const emptyRedact: RedactState = { marks: [], selected: null, past: [], future: [] };

let counter = 0;
export function newMarkId(): string {
  counter += 1;
  return `mark-${Date.now().toString(36)}-${counter}`;
}

function record(state: RedactState, marks: RedactMark[], selected: string | null): RedactState {
  return { marks, selected, past: [...state.past, state.marks].slice(-MAX_REDACT_UNDO), future: [] };
}

export function redactReducer(state: RedactState, action: RedactAction): RedactState {
  switch (action.type) {
    case 'reset':
      return emptyRedact;
    case 'add':
      if (action.marks.length === 0) return state;
      return record(state, [...state.marks, ...action.marks], action.marks.length === 1 ? action.marks[0].id : state.selected);
    case 'remove': {
      const gone = new Set(action.ids);
      const marks = state.marks.filter((m) => !gone.has(m.id));
      if (marks.length === state.marks.length) return state;
      return record(state, marks, state.selected && gone.has(state.selected) ? null : state.selected);
    }
    case 'select':
      return { ...state, selected: action.id };
    case 'undo': {
      if (state.past.length === 0) return state;
      const marks = state.past[state.past.length - 1];
      return {
        marks,
        selected: marks.some((m) => m.id === state.selected) ? state.selected : null,
        past: state.past.slice(0, -1),
        future: [state.marks, ...state.future],
      };
    }
    case 'redo': {
      if (state.future.length === 0) return state;
      const marks = state.future[0];
      return {
        marks,
        selected: marks.some((m) => m.id === state.selected) ? state.selected : null,
        past: [...state.past, state.marks],
        future: state.future.slice(1),
      };
    }
  }
}

/**
 * Search terms whose every match is still marked. After redacting, each of these must be found
 * nowhere in the new file; a term whose matches were partly unmarked may rightly still be there.
 */
export function completeTerms(marks: RedactMark[]): string[] {
  const groups = new Map<string, { term: string; size: number; count: number }>();
  for (const m of marks) {
    if (m.kind !== 'search' || !m.group || !m.term) continue;
    const g = groups.get(m.group) ?? { term: m.term, size: m.groupSize ?? 0, count: 0 };
    g.count++;
    groups.set(m.group, g);
  }
  return [...new Set([...groups.values()].filter((g) => g.count === g.size).map((g) => g.term))];
}

/** Marks by page, in page order, for the review list. */
export function marksByPage(marks: RedactMark[]): [number, RedactMark[]][] {
  const pages = new Map<number, RedactMark[]>();
  for (const m of marks) pages.set(m.page, [...(pages.get(m.page) ?? []), m]);
  return [...pages.entries()].sort((a, b) => a[0] - b[0]);
}

/** "Area", "“John Smith”" — what a mark is, in a few words. */
export function markLabel(mark: RedactMark): string {
  if (mark.kind === 'area') return 'Area';
  const text = (mark.text ?? '').replace(/\s+/g, ' ').trim();
  return text ? `“${text.length > 40 ? `${text.slice(0, 39)}…` : text}”` : 'Text';
}
