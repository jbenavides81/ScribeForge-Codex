import { describe, expect, it } from 'vitest';
import { outputName, pageLabel, parseRanges, safeFileName, splitEvery } from '../../src/engine/names';

describe('output file names', () => {
  it('describes page numbers briefly', () => {
    expect(pageLabel([4])).toBe('page 4');
    expect(pageLabel([1, 2, 3])).toBe('pages 1-3');
    expect(pageLabel([1, 2, 3, 5, 7, 8, 9])).toBe('pages 1-3, 5, 7-9');
    expect(pageLabel([3, 1, 2])).toBe('pages 3, 1-2');
    expect(pageLabel(Array.from({ length: 30 }, (_, i) => i * 2 + 1))).toBe('30 pages');
  });

  it('names new files after the original', () => {
    expect(outputName('Report.pdf', 'edited')).toBe('Report (edited).pdf');
    expect(outputName('Report.PDF', 'merged')).toBe('Report (merged).pdf');
    expect(outputName('Report.pdf', { pages: [2, 3, 4] })).toBe('Report (pages 2-4).pdf');
  });

  it('makes names Windows accepts', () => {
    expect(safeFileName('a<b>c:d"e/f\\g|h?i*j')).toBe('a-b-c-d-e-f-g-h-i-j');
    expect(safeFileName('name. . ')).toBe('name');
    expect(safeFileName('CON')).toBe('_CON');
    expect(safeFileName('')).toBe('document');
    expect(safeFileName('x'.repeat(300))).toHaveLength(150);
  });
});

describe('split ranges', () => {
  it('reads ranges and single pages', () => {
    expect(parseRanges('1-3, 4, 6 - 7', 10)).toEqual({ ok: true, parts: [[1, 2, 3], [4], [6, 7]] });
    expect(parseRanges(' 2 ', 2)).toEqual({ ok: true, parts: [[2]] });
  });

  it('explains what is wrong, in plain words', () => {
    expect(parseRanges('', 5)).toMatchObject({ ok: false, error: expect.stringContaining('Type the page ranges') });
    expect(parseRanges('1-3, x', 5)).toMatchObject({ ok: false, error: expect.stringContaining('"x" isn\'t a page or a range') });
    expect(parseRanges('4-9', 5)).toMatchObject({ ok: false, error: expect.stringContaining('the last page, which is page 5') });
    expect(parseRanges('5-2', 5)).toMatchObject({ ok: false, error: expect.stringContaining('runs backwards') });
    expect(parseRanges('0', 5)).toMatchObject({ ok: false, error: 'Pages are numbered from 1.' });
  });

  it('splits every N pages', () => {
    expect(splitEvery(5, 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(splitEvery(3, 1)).toEqual([[1], [2], [3]]);
    expect(splitEvery(3, 10)).toEqual([[1, 2, 3]]);
  });
});
