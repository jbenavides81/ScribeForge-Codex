import { describe, expect, it } from 'vitest';
import type { PageItem } from '../../src/engine/types';
import { canRemove, editReducer, emptyEdit, hasChanges, MAX_UNDO, type EditAction, type EditState, type Tile } from '../../src/renderer/src/pages/editState';

const tile = (n: number): Tile => ({ key: `k${n}`, item: { kind: 'page', source: 's', index: n - 1, rotate: 0 } });
const start = (count = 5): EditState => editReducer(emptyEdit, { type: 'reset', tiles: Array.from({ length: count }, (_, i) => tile(i + 1)) });
const run = (state: EditState, ...actions: EditAction[]) => actions.reduce(editReducer, state);
const order = (s: EditState) => s.tiles.map((t) => t.key).join(' ');
const sel = (...keys: string[]): EditAction[] => keys.map((key, i) => ({ type: 'select', key, mode: i === 0 ? 'only' : 'toggle' }));

describe('Pages screen editing', () => {
  it('starts with no changes', () => {
    const s = start();
    expect(order(s)).toBe('k1 k2 k3 k4 k5');
    expect(hasChanges(s)).toBe(false);
  });

  it('selects one, adds with Ctrl, a range with Shift, all, or none', () => {
    let s = run(start(), { type: 'select', key: 'k2', mode: 'only' }, { type: 'select', key: 'k4', mode: 'toggle' });
    expect(s.selected).toEqual(['k2', 'k4']);
    s = run(s, { type: 'select', key: 'k4', mode: 'toggle' });
    expect(s.selected).toEqual(['k2']);
    s = run(start(), { type: 'select', key: 'k2', mode: 'only' }, { type: 'select', key: 'k5', mode: 'range' });
    expect(s.selected).toEqual(['k2', 'k3', 'k4', 'k5']);
    s = run(s, { type: 'select', key: 'k1', mode: 'range' });
    expect(s.selected).toEqual(['k1', 'k2']);
    expect(run(s, { type: 'select-all' }).selected).toHaveLength(5);
    expect(run(s, { type: 'select-none' }).selected).toEqual([]);
    expect(hasChanges(s)).toBe(false);
  });

  it('rotates the selected pages right and left, and blank pages swap width and height', () => {
    let s = run(start(), ...sel('k1', 'k3'), { type: 'rotate', by: 90 });
    expect(s.tiles.map((t) => (t.item.kind === 'page' ? t.item.rotate : -1))).toEqual([90, 0, 90, 0, 0]);
    s = run(s, { type: 'rotate', by: 270 }, { type: 'rotate', by: 270 });
    expect(s.tiles.map((t) => (t.item.kind === 'page' ? t.item.rotate : -1))).toEqual([270, 0, 270, 0, 0]);
    const blank: Tile = { key: 'b', item: { kind: 'blank', width: 612, height: 792 } };
    s = run(start(1), { type: 'insert-blank', tile: blank }, { type: 'rotate', by: 90 });
    expect(s.tiles[1].item).toEqual({ kind: 'blank', width: 792, height: 612 });
  });

  it('deletes the selection but never the last page', () => {
    let s = run(start(), ...sel('k2', 'k4'), { type: 'remove' });
    expect(order(s)).toBe('k1 k3 k5');
    expect(s.selected).toEqual([]);
    s = run(s, { type: 'select-all' });
    expect(canRemove(s)).toBe(false);
    expect(order(run(s, { type: 'remove' }))).toBe('k1 k3 k5');
  });

  it('moves pages by dragging to a position', () => {
    expect(order(run(start(), { type: 'move', keys: ['k4'], to: 0 }))).toBe('k4 k1 k2 k3 k5');
    expect(order(run(start(), { type: 'move', keys: ['k1'], to: 5 }))).toBe('k2 k3 k4 k5 k1');
    expect(order(run(start(), { type: 'move', keys: ['k1', 'k3'], to: 4 }))).toBe('k2 k4 k1 k3 k5');
    expect(order(run(start(), { type: 'move', keys: ['k2', 'k5'], to: 1 }))).toBe('k1 k2 k5 k3 k4');
    // Dropping a page where it already is changes nothing and adds no undo step.
    const same = run(start(), { type: 'move', keys: ['k3'], to: 2 });
    expect(order(same)).toBe('k1 k2 k3 k4 k5');
    expect(hasChanges(same)).toBe(false);
  });

  it('moves the selection one place earlier or later, stopping at the ends', () => {
    let s = run(start(), ...sel('k3'), { type: 'shift', by: -1 });
    expect(order(s)).toBe('k1 k3 k2 k4 k5');
    s = run(s, { type: 'shift', by: -1 }, { type: 'shift', by: -1 });
    expect(order(s)).toBe('k3 k1 k2 k4 k5');
    s = run(start(), ...sel('k4', 'k5'), { type: 'shift', by: 1 });
    expect(order(s)).toBe('k1 k2 k3 k4 k5');
    s = run(start(), ...sel('k2', 'k3'), { type: 'shift', by: 1 });
    expect(order(s)).toBe('k1 k4 k2 k3 k5');
  });

  it('inserts a blank page and added files after the last selected page, or at the end', () => {
    const blank: Tile = { key: 'b', item: { kind: 'blank', width: 612, height: 792 } };
    expect(order(run(start(3), ...sel('k1'), { type: 'insert-blank', tile: blank }))).toBe('k1 b k2 k3');
    expect(order(run(start(3), { type: 'insert-blank', tile: blank }))).toBe('k1 k2 k3 b');
    const added: Tile[] = [{ key: 'x1', item: { kind: 'page', source: 'x', index: 0, rotate: 0 } as PageItem }, { key: 'x2', item: { kind: 'page', source: 'x', index: 1, rotate: 0 } }];
    const s = run(start(3), ...sel('k2'), { type: 'add', tiles: added });
    expect(order(s)).toBe('k1 k2 x1 x2 k3');
    expect(s.selected).toEqual(['x1', 'x2']);
  });

  it('undoes and redoes every change, and a new change clears redo', () => {
    let s = run(start(), ...sel('k1'), { type: 'rotate', by: 90 }, { type: 'move', keys: ['k1'], to: 5 }, { type: 'remove' });
    expect(order(s)).toBe('k2 k3 k4 k5');
    s = run(s, { type: 'undo' });
    expect(order(s)).toBe('k2 k3 k4 k5 k1');
    s = run(s, { type: 'undo' }, { type: 'undo' });
    expect(order(s)).toBe('k1 k2 k3 k4 k5');
    expect(hasChanges(s)).toBe(false);
    expect(s.tiles[0].item).toMatchObject({ rotate: 0 });
    s = run(s, { type: 'undo' });
    expect(order(s)).toBe('k1 k2 k3 k4 k5');
    s = run(s, { type: 'redo' }, { type: 'redo' });
    expect(order(s)).toBe('k2 k3 k4 k5 k1');
    expect(s.tiles[4].item).toMatchObject({ rotate: 90 });
    s = run(s, { type: 'move', keys: ['k2'], to: 5 });
    expect(s.future).toEqual([]);
    expect(run(s, { type: 'redo' })).toBe(s);
  });

  it(`keeps the last ${MAX_UNDO} changes`, () => {
    let s = run(start(2), ...sel('k1'));
    for (let i = 0; i < MAX_UNDO + 20; i++) s = run(s, { type: 'rotate', by: 90 });
    expect(s.past).toHaveLength(MAX_UNDO);
  });
});
