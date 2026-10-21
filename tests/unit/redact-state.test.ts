// Redaction marks before they're applied: adding, removing, undo and redo, the review list, and
// which search terms the last check covers.
import { describe, expect, it } from 'vitest';
import { completeTerms, emptyRedact, markLabel, marksByPage, redactReducer, type RedactMark } from '../../src/renderer/src/redact/redactState';

const mark = (id: string, page: number, over: Partial<RedactMark> = {}): RedactMark => ({ id, page, kind: 'area', rects: [[0, 0, 10, 10]], ...over });
const search = (id: string, page: number, group: string, groupSize: number, term = 'Smith'): RedactMark =>
  mark(id, page, { kind: 'search', text: term, term, group, groupSize });

describe('redaction marks', () => {
  it('adds, removes, undoes and redoes; a single new mark is selected', () => {
    let s = redactReducer(emptyRedact, { type: 'add', marks: [mark('a', 0)] });
    expect(s.selected).toBe('a');
    s = redactReducer(s, { type: 'add', marks: [mark('b', 1), mark('c', 1)] });
    expect(s.marks.map((m) => m.id)).toEqual(['a', 'b', 'c']);
    expect(s.selected).toBe('a');
    s = redactReducer(s, { type: 'remove', ids: ['a', 'c'] });
    expect(s.marks.map((m) => m.id)).toEqual(['b']);
    expect(s.selected).toBeNull();
    s = redactReducer(s, { type: 'undo' });
    expect(s.marks.map((m) => m.id)).toEqual(['a', 'b', 'c']);
    s = redactReducer(s, { type: 'redo' });
    expect(s.marks.map((m) => m.id)).toEqual(['b']);
    expect(redactReducer(s, { type: 'remove', ids: ['zzz'] })).toBe(s);
    expect(redactReducer(s, { type: 'add', marks: [] })).toBe(s);
    expect(redactReducer(s, { type: 'reset' })).toEqual(emptyRedact);
  });

  it('lists marks by page, with short labels', () => {
    const list = marksByPage([mark('a', 2), mark('b', 0), mark('c', 2, { kind: 'text', text: '  John\n Smith ' })]);
    expect(list.map(([page, marks]) => [page, marks.map((m) => m.id)])).toEqual([
      [0, ['b']],
      [2, ['a', 'c']],
    ]);
    expect(markLabel(mark('a', 0))).toBe('Area');
    expect(markLabel(mark('c', 0, { kind: 'text', text: '  John\n Smith ' }))).toBe('“John Smith”');
    expect(markLabel(mark('d', 0, { kind: 'text', text: 'x'.repeat(60) }))).toHaveLength(42);
  });

  it('checks a search term only while every one of its matches is still marked', () => {
    const marks = [search('a', 0, 'g1', 2), search('b', 1, 'g1', 2), search('c', 1, 'g2', 1, 'Jones'), mark('d', 0)];
    expect(completeTerms(marks)).toEqual(['Smith', 'Jones']);
    expect(completeTerms(marks.filter((m) => m.id !== 'b'))).toEqual(['Jones']);
  });
});
