// Stop 2b: the screen's side of the full set of annotations, as plain functions: moving and
// resizing, replies, changes to annotations already in the file, what's saved, and the comments list.
import { describe, expect, it } from 'vitest';
import type { Quad } from '../../src/engine/types';
import { annotReducer, emptyAnnots, hasAnnotChanges, moved, scaledPaths, toEngineInput, type Annot, type AnnotAction, type AnnotState } from '../../src/renderer/src/annotate/annotState';
import { commentEntries } from '../../src/renderer/src/annotate/CommentsPanel';
import { asAnnot, canRedraw, fileAnnotsOf, fileChanges, fileKindName, hiddenFromViewer, paletteMatch, pdfDateToIso, type FileAnnot } from '../../src/renderer/src/annotate/fileAnnots';

const box: Quad = [100, 200, 200, 200, 100, 150, 200, 150];
const make = (id: string, kind: Annot['kind'], extra: Partial<Annot> = {}): Annot => ({ id, page: 0, kind, colourId: 'blue', text: '', rotation: 0, createdAt: '2026-10-21T12:00:00.000Z', ...extra });
const run = (state: AnnotState, ...actions: AnnotAction[]) => actions.reduce(annotReducer, state);

describe('moving, resizing and replies', () => {
  it('a drag is one undo step however many moves it takes', () => {
    let s = run(emptyAnnots, { type: 'add', annot: make('s', 'stamp', { box, label: 'Approved', date: 'Today' }) });
    for (const dx of [1, 2, 3, 4]) s = run(s, { type: 'update', id: 's', typing: 'drag-1', ...moved(make('s', 'stamp', { box }), dx, 0) });
    expect(s.items[0].box?.[0]).toBe(104);
    s = run(s, { type: 'update', id: 's', typing: 'drag-2', box: [0, 0, 0, 0, 0, 0, 0, 0] });
    s = run(s, { type: 'undo' });
    expect(s.items[0].box?.[0]).toBe(104);
    s = run(s, { type: 'undo' });
    expect(s.items[0].box?.[0]).toBe(100);
  });

  it('moves every kind of shape, and scales a drawing into a new box', () => {
    expect(moved(make('a', 'note', { box }), 10, -5).box).toEqual([110, 195, 210, 195, 110, 145, 210, 145]);
    expect(moved(make('a', 'ink', { paths: [[[0, 0], [10, 10]]] }), 1, 2).paths).toEqual([[[1, 2], [11, 12]]]);
    expect(moved(make('a', 'arrow', { from: [0, 0], to: [10, 0] }), 5, 5)).toEqual({ from: [5, 5], to: [15, 5] });
    expect(moved(make('a', 'highlight', { quads: [box] }), 5, 5)).toEqual({});
    expect(scaledPaths([[[0, 0], [10, 10]]], [0, 0, 10, 10], [0, 0, 20, 40])).toEqual([[[0, 0], [20, 40]]]);
  });

  it('deleting an annotation deletes the replies to it, and replies to those', () => {
    let s = run(
      emptyAnnots,
      { type: 'add', annot: make('h', 'highlight', { quads: [box] }) },
      { type: 'add', annot: make('r1', 'reply', { replyTo: 'h', text: 'Yes' }) },
      { type: 'add', annot: make('r2', 'reply', { replyTo: 'r1', text: 'Thanks' }) },
      { type: 'add', annot: make('n', 'note', { box }) },
    );
    s = run(s, { type: 'remove', id: 'h' });
    expect(s.items.map((a) => a.id)).toEqual(['n']);
    s = run(s, { type: 'undo' });
    expect(s.items.map((a) => a.id)).toEqual(['h', 'r1', 'r2', 'n']);
  });

  it('what is saved for each new kind; empty stamps and replies are not', () => {
    const save = (a: Annot) => toEngineInput(a, 'doc1', 'Pat');
    expect(save(make('i', 'ink', { paths: [[[1, 2]]], width: 4 }))).toMatchObject({ kind: 'ink', width: 4, colour: [0.11, 0.357, 0.69], author: 'Pat' });
    expect(save(make('r', 'rect', { box, fill: true }))).toMatchObject({ kind: 'rect', width: 2, fill: [0.612, 0.796, 1] });
    expect(save(make('e', 'ellipse', { box }))).toMatchObject({ kind: 'ellipse', fill: undefined });
    expect(save(make('a', 'arrow', { from: [0, 0], to: [1, 1], text: 'Here' }))).toMatchObject({ kind: 'arrow', comment: 'Here' });
    expect(save(make('s', 'stamp', { box, stamp: 'approved', label: ' Approved ', date: 'October 21, 2026', flatten: true }))).toMatchObject({ kind: 'stamp', label: 'Approved', flatten: true });
    expect(save(make('s2', 'stamp', { box, stamp: 'custom', label: '  ' }))).toBeNull();
    expect(save(make('p', 'reply', { replyTo: 'file:12R', text: 'Agreed' }))).toMatchObject({ kind: 'reply', replyTo: 'file:12R', comment: 'Agreed' });
    expect(save(make('p2', 'reply', { replyTo: 'x', text: ' ' }))).toBeNull();
  });
});

const fileNote = (extra: Partial<FileAnnot> = {}): FileAnnot => ({
  id: '19R',
  page: 0,
  subtype: 'Text',
  rect: [500, 698, 522, 720],
  colour: [255, 228, 92],
  contents: 'Old note',
  author: 'Alex Doe',
  modified: '',
  hidden: false,
  pageRotation: 0,
  ...extra,
});

describe('annotations already in the file', () => {
  it('are read from pdf.js, leaving out links, form fields and pop-ups', () => {
    const read = fileAnnotsOf(2, 90, [
      { id: '1R', subtype: 'Link', rect: [0, 0, 1, 1] },
      { id: '2R', subtype: 'Widget', rect: [0, 0, 1, 1] },
      { id: '3R', subtype: 'Popup', rect: [0, 0, 1, 1] },
      { id: '4R', subtype: 'Highlight', rect: [0, 0, 10, 10], color: [255, 228, 92], contentsObj: { str: 'Hi' }, titleObj: { str: 'Alex' }, quadPoints: new Float32Array([0, 10, 10, 10, 0, 0, 10, 0]), modificationDate: "D:20261021143000+02'00'" },
      { id: '5R', subtype: 'Text', rect: [0, 0, 22, 22], inReplyTo: '4R', replyType: 'R', contentsObj: { str: 'A reply' } },
      { id: '6R', subtype: 'Text', rect: [0, 0, 22, 22], inReplyTo: '4R', replyType: 'Group' },
    ]);
    expect(read.map((f) => f.id)).toEqual(['4R', '5R', '6R']);
    expect(read[0]).toMatchObject({ page: 2, subtype: 'Highlight', author: 'Alex', contents: 'Hi', colour: [255, 228, 92], quadPoints: [0, 10, 10, 10, 0, 0, 10, 0], pageRotation: 90, modified: '2026-10-21T12:30:00.000Z' });
    expect(read[1].inReplyTo).toBe('4R');
    expect(read[2].inReplyTo).toBeUndefined(); // grouped with it, not a reply
    expect(pdfDateToIso('D:2026')).toBe('2026-01-01T00:00:00.000Z');
    expect(pdfDateToIso('nonsense')).toBe('');
  });

  it('are named in plain words, and can be redrawn when ScribeForge knows how', () => {
    expect(fileKindName(fileNote())).toBe('Note');
    expect(fileKindName(fileNote({ inReplyTo: '1R' }))).toBe('Reply');
    expect(fileKindName({ subtype: 'Line', lineEndings: ['None', 'OpenArrow'] })).toBe('Arrow');
    expect(fileKindName({ subtype: 'Squiggly' })).toBe('Wavy underline');
    expect(canRedraw(fileNote())).toBe(true);
    expect(canRedraw(fileNote({ subtype: 'Stamp' }))).toBe(false);
    expect(canRedraw(fileNote({ subtype: 'Highlight' }))).toBe(false); // no corners to redraw
    expect(paletteMatch(fileNote())).toBe('yellow');
    expect(paletteMatch(fileNote({ colour: [1, 2, 3] }))).toBeUndefined();
  });

  it('changes become what the engine saves', () => {
    const highlight = fileNote({ id: '4R', subtype: 'Highlight', quadPoints: [0, 10, 10, 10, 0, 0, 10, 0] });
    const freeText = fileNote({ id: '7R', subtype: 'FreeText', contents: 'Old text', fontSize: 14 });
    const stamp = fileNote({ id: '8R', subtype: 'Stamp' });
    const changes = fileChanges(
      [fileNote(), highlight, freeText, stamp],
      {
        '19R': { text: 'New note' },
        '4R': { colourId: 'green' },
        '7R': { text: 'New text' },
        '8R': { deleted: true },
      },
      'doc1',
      false,
    );
    expect(changes).toEqual([
      { source: 'doc1', index: 0, ref: '19R', comment: 'New note' },
      expect.objectContaining({ ref: '4R', redraw: expect.objectContaining({ kind: 'highlight', quads: [[0, 10, 10, 10, 0, 0, 10, 0]], colour: [0.608, 0.898, 0.561], comment: 'Old note' }) }),
      expect.objectContaining({ ref: '7R', redraw: expect.objectContaining({ kind: 'text', text: 'New text', fontSize: 14 }) }),
      { source: 'doc1', index: 0, ref: '8R', deleted: true },
    ]);
    expect(changes[2].comment).toBeUndefined();
    // Choosing the colour it already has, or nothing at all, changes nothing.
    expect(fileChanges([fileNote()], { '19R': { colourId: 'yellow' } }, 'doc1', false)).toEqual([]);
    // Burn in this one; with "burn all" every one is burned in anyway.
    expect(fileChanges([fileNote()], { '19R': { flatten: true } }, 'doc1', false)).toEqual([{ source: 'doc1', index: 0, ref: '19R', flatten: true }]);
    expect(fileChanges([fileNote()], { '19R': { flatten: true } }, 'doc1', true)).toEqual([]);
  });

  it('pdf.js is kept from drawing replies, deleted ones and redrawn ones', () => {
    const files = [fileNote(), fileNote({ id: '20R', inReplyTo: '19R' }), fileNote({ id: '21R' }), fileNote({ id: '22R' })];
    expect(hiddenFromViewer(files, { '21R': { deleted: true }, '22R': { colourId: 'red' }, '19R': { text: 'Only the comment' } })).toEqual(['20R', '21R', '22R']);
    expect(asAnnot(fileNote(), { colourId: 'red' })).toMatchObject({ id: 'file:19R', kind: 'note', colourId: 'red', box: [500, 720, 522, 720, 500, 698, 522, 698] });
  });

  it('count as unsaved changes, can be undone, and deleting one drops replies added to it', () => {
    let s = run(emptyAnnots, { type: 'add', annot: make('r', 'reply', { replyTo: 'file:19R', text: 'Hi' }) });
    s = run(s, { type: 'select', id: 'file:19R' }, { type: 'edit-file', ref: '19R', deleted: true });
    expect(s.items).toEqual([]);
    expect(s.selected).toBeNull();
    expect(s.edits['19R']).toEqual({ deleted: true });
    s = run(s, { type: 'undo' });
    expect(s.edits['19R']).toBeUndefined();
    expect(s.items.map((a) => a.id)).toEqual(['r']);
    expect(hasAnnotChanges(run(emptyAnnots, { type: 'flatten-all', on: true }))).toBe(true);
  });
});

describe('the comments list', () => {
  it('lists old and new by page, counts whole reply threads, and leaves out deleted ones', () => {
    const files = [
      fileNote({ id: '30R', page: 2, subtype: 'Highlight', contents: 'Second page' }),
      fileNote(),
      fileNote({ id: '20R', inReplyTo: '19R', contents: 'Reply' }),
      fileNote({ id: '23R', inReplyTo: '20R', contents: 'Reply to the reply' }),
      fileNote({ id: '21R', contents: 'Deleted' }),
    ];
    const added = [make('n', 'note', { page: 1, box, text: 'Mine' }), make('r', 'reply', { replyTo: 'file:20R', text: 'Also me' })];
    const entries = commentEntries(added, files, { '21R': { deleted: true } }, 'Pat');
    expect(entries.map((e) => [e.page, e.kind, e.author, e.text, e.replies])).toEqual([
      [0, 'Note', 'Alex Doe', 'Old note', 3],
      [1, 'Note', 'Pat', 'Mine', 0],
      [2, 'Highlight', 'Alex Doe', 'Second page', 0],
    ]);
  });
});
