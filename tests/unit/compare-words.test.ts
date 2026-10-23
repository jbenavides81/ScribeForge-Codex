// The words for comparing versions (stop 3c): the summary, page headings and text changes.
import { describe, expect, it } from 'vitest';
import type { Comparison, PageComparison } from '../../src/engine/compare/compare';
import { compareProgress, compareSummary, pageHeading, textChangeLines } from '../../src/renderer/src/compare/describe';

const counts = (c: Partial<Comparison>): Comparison => ({ pages: [], identical: false, same: 0, changed: 0, added: 0, removed: 0, ...c });
const page = (p: Partial<PageComparison>): PageComparison => ({ a: 1, b: 1, status: 'changed', regions: [], text: { removed: [], added: [], moved: [] }, ...p });

describe('comparison words', () => {
  it('sums up, or says the versions are identical', () => {
    expect(compareSummary(counts({ changed: 3, added: 1, removed: 1, same: 1 }))).toBe('3 pages changed, 1 page added, 1 page removed and 1 page the same.');
    expect(compareSummary(counts({ changed: 1 }))).toBe('1 page changed.');
    expect(compareSummary(counts({ added: 2, same: 4 }))).toBe('2 pages added and 4 pages the same.');
    expect(compareSummary(counts({ identical: true, same: 5 }))).toBe('The two versions are identical: all 5 pages are the same.');
    expect(compareSummary(counts({ identical: true, same: 1 }))).toBe('The two versions are identical: the page is the same.');
  });

  it('heads each page with where it is in each version', () => {
    expect(pageHeading(page({ a: 2, b: 2 }), 2)).toBe('Page 2: changed');
    expect(pageHeading(page({ a: 2, b: 3 }), 2)).toBe('Page 2, now page 3: changed');
    expect(pageHeading(page({ a: 1, b: 1, status: 'same' }), 2)).toBe('Page 1: the same');
    expect(pageHeading(page({ a: null, b: 2, status: 'added' }), 4)).toBe('Page 2: added in version 4');
    expect(pageHeading(page({ a: 5, b: null, status: 'removed' }), 2)).toBe('Page 5: removed in version 2');
  });

  it('lists the words removed, added and moved, or says only something drawn changed', () => {
    expect(textChangeLines({ removed: ['100'], added: ['120'], moved: [] }, 'changed')).toEqual(['Words removed: “100”', 'Words added: “120”']);
    expect(textChangeLines({ removed: [], added: [], moved: ['Block Alpha says hello.'] }, 'changed')).toEqual(['Moved on the page: “Block Alpha says hello.”']);
    expect(textChangeLines({ removed: [], added: [], moved: [] }, 'changed')).toEqual(['No words changed. Something drawn on the page changed, such as a picture, a line or a colour.']);
    expect(textChangeLines({ removed: [], added: [], moved: [] }, 'added')).toEqual([]);
    const many = Array.from({ length: 23 }, (_, i) => `w${i}`);
    expect(textChangeLines({ removed: many, added: [], moved: [] }, 'changed')[0]).toMatch(/“w19” and 3 more$/);
  });

  it('says how far it has got', () => {
    expect(compareProgress('reading', 3, 10)).toBe('Reading the pages: 3 of 10…');
    expect(compareProgress('comparing', 2, 6)).toBe('Comparing pages: 2 of 6…');
  });
});
