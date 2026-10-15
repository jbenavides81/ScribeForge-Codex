// The Pages screen's state: the pages in their new order, which are selected, and undo/redo.
// Plain functions with no screen code, so the unit tests can check every edit.
import type { PageItem, Rotation } from '../../../engine/types';

export interface Tile {
  /** Stable for the life of the tile, even as it moves. */
  key: string;
  item: PageItem;
}

export interface EditState {
  tiles: Tile[];
  selected: string[];
  /** Where a Shift+click selection range starts. */
  anchor: string | null;
  past: Tile[][];
  future: Tile[][];
}

export type EditAction =
  | { type: 'reset'; tiles: Tile[] }
  | { type: 'select'; key: string; mode: 'only' | 'toggle' | 'range' }
  | { type: 'select-all' }
  | { type: 'select-none' }
  | { type: 'rotate'; by: 90 | 270 }
  | { type: 'remove' }
  | { type: 'move'; keys: string[]; to: number }
  | { type: 'shift'; by: -1 | 1 }
  | { type: 'insert-blank'; tile: Tile }
  | { type: 'add'; tiles: Tile[] }
  | { type: 'undo' }
  | { type: 'redo' };

export const MAX_UNDO = 100;

export const emptyEdit: EditState = { tiles: [], selected: [], anchor: null, past: [], future: [] };

let counter = 0;
export function newKey(prefix: string): string {
  counter += 1;
  return `${prefix}#${counter}`;
}

export function hasChanges(state: EditState): boolean {
  return state.past.length > 0;
}

/** Selected tiles in page order. */
export function selectedTiles(state: EditState): Tile[] {
  return state.tiles.filter((t) => state.selected.includes(t.key));
}

/** Can the selection be deleted? A PDF must keep at least one page. */
export function canRemove(state: EditState): boolean {
  return state.selected.length > 0 && state.selected.length < state.tiles.length;
}

function sameOrder(a: Tile[], b: Tile[]): boolean {
  return a.length === b.length && a.every((t, i) => t === b[i]);
}

/** Records a change for undo. */
function change(state: EditState, tiles: Tile[], selected = state.selected): EditState {
  if (sameOrder(tiles, state.tiles) && tiles.every((t, i) => t.item === state.tiles[i].item)) return state;
  return { ...state, tiles, selected, past: [...state.past, state.tiles].slice(-MAX_UNDO), future: [] };
}

function rotateItem(item: PageItem, by: 90 | 270): PageItem {
  if (item.kind === 'blank') return { ...item, width: item.height, height: item.width };
  return { ...item, rotate: (((item.rotate + by) % 360) as Rotation) };
}

/** Moves `keys` so they sit at insertion point `to` (counted in the current list). */
function moved(tiles: Tile[], keys: string[], to: number): Tile[] {
  const moving = tiles.filter((t) => keys.includes(t.key));
  if (moving.length === 0) return tiles;
  const rest = tiles.filter((t) => !keys.includes(t.key));
  const at = tiles.slice(0, Math.max(0, Math.min(to, tiles.length))).filter((t) => !keys.includes(t.key)).length;
  return [...rest.slice(0, at), ...moving, ...rest.slice(at)];
}

/** Where new tiles go: after the last selected page, or at the end. */
function insertionPoint(state: EditState): number {
  const last = state.tiles.reduce((acc, t, i) => (state.selected.includes(t.key) ? i : acc), -1);
  return last === -1 ? state.tiles.length : last + 1;
}

export function editReducer(state: EditState, action: EditAction): EditState {
  switch (action.type) {
    case 'reset':
      return { tiles: action.tiles, selected: [], anchor: null, past: [], future: [] };

    case 'select': {
      if (action.mode === 'only') return { ...state, selected: [action.key], anchor: action.key };
      if (action.mode === 'toggle') {
        const on = state.selected.includes(action.key);
        return { ...state, selected: on ? state.selected.filter((k) => k !== action.key) : [...state.selected, action.key], anchor: action.key };
      }
      const from = state.tiles.findIndex((t) => t.key === (state.anchor ?? action.key));
      const to = state.tiles.findIndex((t) => t.key === action.key);
      const [a, b] = from <= to ? [from, to] : [to, from];
      return { ...state, selected: state.tiles.slice(a, b + 1).map((t) => t.key) };
    }

    case 'select-all':
      return { ...state, selected: state.tiles.map((t) => t.key) };

    case 'select-none':
      return { ...state, selected: [], anchor: null };

    case 'rotate':
      return change(
        state,
        state.tiles.map((t) => (state.selected.includes(t.key) ? { ...t, item: rotateItem(t.item, action.by) } : t)),
      );

    case 'remove': {
      if (!canRemove(state)) return state;
      const tiles = state.tiles.filter((t) => !state.selected.includes(t.key));
      return { ...change(state, tiles, []), anchor: null };
    }

    case 'move':
      return change(state, moved(state.tiles, action.keys, action.to));

    case 'shift': {
      const indices = state.tiles.flatMap((t, i) => (state.selected.includes(t.key) ? [i] : []));
      if (indices.length === 0) return state;
      if (action.by === -1) {
        if (indices[0] === 0) return state;
        return change(state, moved(state.tiles, state.selected, indices[0] - 1));
      }
      const last = indices[indices.length - 1];
      if (last === state.tiles.length - 1) return state;
      return change(state, moved(state.tiles, state.selected, last + 2));
    }

    case 'insert-blank': {
      const at = insertionPoint(state);
      return { ...change(state, [...state.tiles.slice(0, at), action.tile, ...state.tiles.slice(at)], [action.tile.key]), anchor: action.tile.key };
    }

    case 'add': {
      if (action.tiles.length === 0) return state;
      const at = insertionPoint(state);
      return change(state, [...state.tiles.slice(0, at), ...action.tiles, ...state.tiles.slice(at)], action.tiles.map((t) => t.key));
    }

    case 'undo': {
      if (state.past.length === 0) return state;
      const previous = state.past[state.past.length - 1];
      const keys = new Set(previous.map((t) => t.key));
      return {
        ...state,
        tiles: previous,
        selected: state.selected.filter((k) => keys.has(k)),
        past: state.past.slice(0, -1),
        future: [state.tiles, ...state.future],
      };
    }

    case 'redo': {
      if (state.future.length === 0) return state;
      const next = state.future[0];
      const keys = new Set(next.map((t) => t.key));
      return {
        ...state,
        tiles: next,
        selected: state.selected.filter((k) => keys.has(k)),
        past: [...state.past, state.tiles],
        future: state.future.slice(1),
      };
    }
  }
}
