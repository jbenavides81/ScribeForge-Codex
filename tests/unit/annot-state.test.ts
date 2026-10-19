import { describe, expect, it } from 'vitest';
import type { Quad } from '../../src/engine/types';
import { annotReducer, emptyAnnots, hasAnnotChanges, MAX_ANNOT_UNDO, newAnnotId, toEngineInput, type Annot, type AnnotAction, type AnnotState } from '../../src/renderer/src/annotate/annotState';

const quad: Quad = [0, 10, 10, 10, 0, 0, 10, 0];
const annot = (id: string, kind: Annot['kind'] = 'highlight', extra: Partial<Annot> = {}): Annot => ({
  id,
  page: 0,
  kind,
  colourId: 'yellow',
  quads: kind === 'note' || kind === 'text' ? undefined : [quad],
  box: kind === 'note' || kind === 'text' ? quad : undefined,
  text: '',
  rotation: 0,
  createdAt: '2026-10-15T12:00:00.000Z',
  ...extra,
});
const run = (state: AnnotState, ...actions: AnnotAction[]) => actions.reduce(annotReducer, state);

describe('annotations being edited', () => {
  it('adds and selects a new annotation, which counts as a change', () => {
    const s = run(emptyAnnots, { type: 'add', annot: annot('a') });
    expect(s.items.map((a) => a.id)).toEqual(['a']);
    expect(s.selected).toBe('a');
    expect(hasAnnotChanges(s)).toBe(true);
    expect(hasAnnotChanges(emptyAnnots)).toBe(false);
  });

  it('changes colour and text, and deletes', () => {
    let s = run(emptyAnnots, { type: 'add', annot: annot('a') }, { type: 'add', annot: annot('b') });
    s = run(s, { type: 'update', id: 'a', colourId: 'blue' }, { type: 'update', id: 'a', text: 'Note' });
    expect(s.items[0]).toMatchObject({ colourId: 'blue', text: 'Note' });
    s = run(s, { type: 'select', id: 'b' }, { type: 'remove', id: 'b' });
    expect(s.items.map((a) => a.id)).toEqual(['a']);
    expect(s.selected).toBeNull();
  });

  it('typing in one annotation is one undo step', () => {
    let s = run(emptyAnnots, { type: 'add', annot: annot('a', 'note') });
    for (const text of ['H', 'He', 'Hel', 'Hell', 'Hello']) s = run(s, { type: 'update', id: 'a', text, typing: true });
    expect(s.items[0].text).toBe('Hello');
    s = run(s, { type: 'undo' });
    expect(s.items[0].text).toBe('');
    s = run(s, { type: 'undo' });
    expect(s.items).toEqual([]);
    s = run(s, { type: 'redo' }, { type: 'redo' });
    expect(s.items[0].text).toBe('Hello');
  });

  it('undo and redo every change; a new change clears redo; nothing-changes add no step', () => {
    let s = run(emptyAnnots, { type: 'add', annot: annot('a') }, { type: 'update', id: 'a', colourId: 'pink' }, { type: 'remove', id: 'a' });
    expect(s.items).toEqual([]);
    s = run(s, { type: 'undo' });
    expect(s.items[0].colourId).toBe('pink');
    s = run(s, { type: 'undo' });
    expect(s.items[0].colourId).toBe('yellow');
    const before = s.past.length;
    s = run(s, { type: 'update', id: 'a', colourId: 'yellow' });
    expect(s.past.length).toBe(before);
    s = run(s, { type: 'add', annot: annot('b') });
    expect(s.future).toEqual([]);
  });

  it(`keeps the last ${MAX_ANNOT_UNDO} changes`, () => {
    let s = run(emptyAnnots, { type: 'add', annot: annot('a') });
    for (let i = 0; i < MAX_ANNOT_UNDO + 20; i++) s = run(s, { type: 'update', id: 'a', colourId: i % 2 ? 'blue' : 'green' });
    expect(s.past).toHaveLength(MAX_ANNOT_UNDO);
  });

  it('makes unique ids', () => {
    expect(new Set(Array.from({ length: 1000 }, newAnnotId)).size).toBe(1000);
  });
});

describe('what is saved', () => {
  it('uses the light colour for highlights and notes, the strong colour for the rest', () => {
    expect(toEngineInput(annot('a'), 'doc1', 'Pat')).toMatchObject({ kind: 'highlight', colour: [1, 0.894, 0.361], author: 'Pat', source: 'doc1', index: 0 });
    expect(toEngineInput(annot('b', 'underline'), 'doc1', '')).toMatchObject({ kind: 'underline', colour: [0.478, 0.373, 0], author: undefined });
    expect(toEngineInput(annot('c', 'note', { text: 'Hi' }), 'doc1', '')).toMatchObject({ kind: 'note', comment: 'Hi', colour: [1, 0.894, 0.361] });
  });

  it('leaves out empty text boxes and empty comments', () => {
    expect(toEngineInput(annot('t', 'text', { text: '   ' }), 'doc1', '')).toBeNull();
    expect(toEngineInput(annot('t', 'text', { text: 'Hello' }), 'doc1', '')).toMatchObject({ kind: 'text', text: 'Hello', fontSize: 12 });
    expect(toEngineInput(annot('h'), 'doc1', '')).toMatchObject({ comment: undefined });
  });
});
