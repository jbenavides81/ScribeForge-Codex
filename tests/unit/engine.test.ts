// Stop 1b's required checks for the page engine: right pages, order and rotation; removed pages
// found nowhere; every link and bookmark pointing inside the new file; scripts gone; sources
// unchanged; and speed on large files.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildPdf } from '../../src/engine/build';
import type { PageItem, Rotation, SourceInput } from '../../src/engine/types';
import { bookmarks, findEverywhere, fixture, links, pageIds, pageTexts, ROOT, rotations, sizes, strayPages } from './support/inspect';

let linksPdf: SourceInput;
let secondPdf: SourceInput;
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const pages = (source: string, list: number[], rotate: Rotation = 0): PageItem[] =>
  list.map((n) => ({ kind: 'page', source, index: n - 1, rotate }));

beforeAll(() => {
  execFileSync(process.execPath, ['scripts/make-fixtures.mjs'], { cwd: ROOT, stdio: 'ignore' });
  linksPdf = { id: 'a', name: 'links.pdf', bytes: fixture('links.pdf') };
  secondPdf = { id: 'b', name: 'second.pdf', bytes: fixture('second.pdf') };
}, 120_000);

/** Checks every saved file must pass, whatever the operation. */
async function alwaysTrue(bytes: Uint8Array) {
  expect(await strayPages(bytes)).toBe(0);
  for (const link of await links(bytes)) if (link.kind === 'page') expect(link.target, `link on page ${link.page}`).toBeGreaterThan(0);
  const walk = (items: Awaited<ReturnType<typeof bookmarks>>) => {
    for (const b of items) {
      if (b.page !== undefined) expect(b.page, `bookmark ${b.title}`).toBeGreaterThan(0);
      walk(b.children);
    }
  };
  walk(await bookmarks(bytes));
  // No scripts or program-launching actions survive in any form.
  expect(await findEverywhere(bytes, 'JavaScript')).toEqual([]);
  expect(await findEverywhere(bytes, 'SCRIPT RAN')).toEqual([]);
  expect(await findEverywhere(bytes, 'Launch')).toEqual([]);
  expect(await findEverywhere(bytes, 'calc.exe')).toEqual([]);
}

describe('page engine', () => {
  it('keeps all pages, links, bookmarks and details when nothing changes', async () => {
    const { bytes, report } = await buildPdf([linksPdf], pages('a', [1, 2, 3, 4, 5, 6]));
    expect(await pageIds(bytes)).toEqual([1, 2, 3, 4, 5, 6].map((n) => `UNIQUE-PAGE-${n}`));
    const l = await links(bytes);
    expect(l.filter((x) => x.kind === 'page').map((x) => x.target).sort()).toEqual([2, 3, 6]);
    expect(l.filter((x) => x.kind === 'web').map((x) => x.uri)).toEqual(['https://example.com/links-test']);
    expect(l.filter((x) => x.kind === 'other')).toEqual([]);
    expect(await bookmarks(bytes)).toEqual([
      { title: 'Part A', page: 1, children: [{ title: 'Page 2', page: 2, children: [] }, { title: 'Page 3', page: 3, children: [] }] },
      { title: 'Part B', page: undefined, children: [{ title: 'Chapter six', page: 6, children: [] }, { title: 'Page 5', page: 5, children: [] }] },
    ]);
    expect(report).toMatchObject({ pages: 6, linksKept: 3, linksRemoved: 0, bookmarksKept: 5, bookmarksRemoved: 0, formFieldsDetached: 2, strayReferencesCut: 0 });
    expect(report.actionsRemoved).toBeGreaterThanOrEqual(2);
    expect(await rotations(bytes)).toEqual([0, 90, 0, 0, 0, 0]);
    await alwaysTrue(bytes);
  });

  it('reorders pages and keeps links and bookmarks pointing at the moved pages', async () => {
    const { bytes } = await buildPdf([linksPdf], pages('a', [3, 1, 2, 6, 4, 5]));
    expect(await pageIds(bytes)).toEqual(['UNIQUE-PAGE-3', 'UNIQUE-PAGE-1', 'UNIQUE-PAGE-2', 'UNIQUE-PAGE-6', 'UNIQUE-PAGE-4', 'UNIQUE-PAGE-5']);
    // Page 1's links (now on output page 2) go to pages 3, 6 and 2, which are now pages 1, 4 and 3.
    expect((await links(bytes)).filter((x) => x.kind === 'page').map((x) => [x.page, x.target])).toEqual([
      [2, 1],
      [2, 4],
      [2, 3],
    ]);
    const marks = await bookmarks(bytes);
    expect(marks[0]).toMatchObject({ title: 'Part A', page: 2 });
    expect(marks[1].children.map((c) => [c.title, c.page])).toEqual([
      ['Chapter six', 4],
      ['Page 5', 6],
    ]);
    await alwaysTrue(bytes);
  });

  it('deleting a page removes its text from the file, and links and bookmarks to it', async () => {
    const { bytes, report } = await buildPdf([linksPdf], pages('a', [1, 2, 4, 5, 6]));
    expect(await findEverywhere(bytes, 'UNIQUE-PAGE-3')).toEqual([]);
    expect((await links(bytes)).filter((x) => x.kind === 'page').map((x) => x.target).sort()).toEqual([2, 5]);
    expect(report.linksRemoved).toBe(1);
    expect(report.bookmarksRemoved).toBe(1);
    expect((await bookmarks(bytes))[0].children.map((c) => c.title)).toEqual(['Page 2']);
    await alwaysTrue(bytes);
  });

  it('extracting one page brings nothing else along, even through its links', async () => {
    const { bytes, report } = await buildPdf([linksPdf], pages('a', [1]));
    expect(await pageIds(bytes)).toEqual(['UNIQUE-PAGE-1']);
    for (const n of [2, 3, 4, 5, 6]) expect(await findEverywhere(bytes, `UNIQUE-PAGE-${n}`), `page ${n}`).toEqual([]);
    expect(await findEverywhere(bytes, 'REPLY-ON-PAGE-5')).toEqual([]);
    expect((await links(bytes)).map((x) => x.kind)).toEqual(['web']);
    expect(report.linksRemoved).toBe(3);
    await alwaysTrue(bytes);
  });

  it('extracting a page with a form field brings neither the field\'s other page nor its value', async () => {
    const { bytes, report } = await buildPdf([linksPdf], pages('a', [4]));
    expect(await findEverywhere(bytes, 'UNIQUE-PAGE-5')).toEqual([]);
    expect(await findEverywhere(bytes, 'FIELD-VALUE-SECRET')).toEqual([]);
    expect(report.formFieldsDetached).toBe(1);
    await alwaysTrue(bytes);
  });

  it('a reply to a comment on a page that is left out loses only the reply link', async () => {
    const { bytes } = await buildPdf([linksPdf], pages('a', [5]));
    expect(await findEverywhere(bytes, 'REPLY-ON-PAGE-5')).not.toEqual([]);
    expect(await findEverywhere(bytes, 'NOTE-ON-PAGE-1')).toEqual([]);
    expect(await findEverywhere(bytes, 'UNIQUE-PAGE-1')).toEqual([]);
    await alwaysTrue(bytes);
  });

  it('rotation adds to each page\'s own rotation', async () => {
    const items: PageItem[] = [
      { kind: 'page', source: 'a', index: 0, rotate: 270 },
      { kind: 'page', source: 'a', index: 1, rotate: 90 },
      { kind: 'page', source: 'a', index: 2, rotate: 180 },
    ];
    expect(await rotations((await buildPdf([linksPdf], items)).bytes)).toEqual([270, 180, 180]);
  });

  it('inserts blank pages of the given size', async () => {
    const items: PageItem[] = [...pages('a', [1]), { kind: 'blank', width: 612, height: 792 }, ...pages('a', [2])];
    const { bytes } = await buildPdf([linksPdf], items);
    expect(await sizes(bytes)).toEqual([
      [612, 792],
      [612, 792],
      [612, 792],
    ]);
    expect((await pageTexts(bytes))[1]).toBe('');
    await alwaysTrue(bytes);
  });

  it('merges files, nesting each file\'s bookmarks under its name', async () => {
    const { bytes, report } = await buildPdf([linksPdf, secondPdf], [...pages('a', [1, 2, 3, 4, 5, 6]), ...pages('b', [1, 2])]);
    expect(await pageIds(bytes)).toEqual([...[1, 2, 3, 4, 5, 6].map((n) => `UNIQUE-PAGE-${n}`), 'SECOND-DOC-PAGE-1', 'SECOND-DOC-PAGE-2']);
    expect((await sizes(bytes))[6]).toEqual([595, 842]);
    const marks = await bookmarks(bytes);
    expect(marks.map((m) => [m.title, m.page])).toEqual([
      ['links', 1],
      ['second', 7],
    ]);
    expect(marks[0].children.map((c) => c.title)).toEqual(['Part A', 'Part B']);
    expect(marks[1].children).toEqual([{ title: 'Second start', page: 7, children: [] }]);
    // The second file's link from its page 1 to its page 2 now goes from page 7 to page 8.
    expect((await links(bytes)).filter((x) => x.page === 7).map((x) => x.target)).toEqual([8]);
    expect(report.linksKept).toBe(4);
    await alwaysTrue(bytes);
  });

  it('merges in any order, with pages from both files mixed', async () => {
    const items: PageItem[] = [...pages('b', [2]), ...pages('a', [1]), ...pages('b', [1])];
    const { bytes } = await buildPdf([linksPdf, secondPdf], items);
    expect(await pageIds(bytes)).toEqual(['SECOND-DOC-PAGE-2', 'UNIQUE-PAGE-1', 'SECOND-DOC-PAGE-1']);
    expect((await links(bytes)).filter((x) => x.page === 3).map((x) => x.target)).toEqual([1]);
    await alwaysTrue(bytes);
  });

  it('splitting gives files that each contain only their own pages', async () => {
    for (const part of [[1, 2], [3, 4], [5, 6]]) {
      const { bytes } = await buildPdf([linksPdf], pages('a', part));
      expect(await pageIds(bytes)).toEqual(part.map((n) => `UNIQUE-PAGE-${n}`));
      for (const n of [1, 2, 3, 4, 5, 6].filter((x) => !part.includes(x))) expect(await findEverywhere(bytes, `UNIQUE-PAGE-${n}`)).toEqual([]);
      await alwaysTrue(bytes);
    }
  });

  it('opens password-protected files with their password; the new file has none', async () => {
    const protectedPdf: SourceInput = { id: 'p', name: 'protected.pdf', bytes: fixture('protected.pdf'), password: 'open-sesame' };
    const { bytes } = await buildPdf([protectedPdf], pages('p', [2, 1]));
    expect((await pageTexts(bytes))[1]).toContain('Protected test document');
    await expect(buildPdf([{ ...protectedPdf, password: 'wrong' }], pages('p', [1]))).rejects.toThrow();
    await expect(buildPdf([{ ...protectedPdf, password: undefined }], pages('p', [1]))).rejects.toThrow();
  });

  it('refuses impossible requests', async () => {
    await expect(buildPdf([linksPdf], [])).rejects.toThrow('at least one page');
    await expect(buildPdf([linksPdf], pages('a', [7]))).rejects.toThrow('no page 7');
    await expect(buildPdf([linksPdf], pages('zz', [1]))).rejects.toThrow('Unknown source');
  });

  it('never changes the source files\' bytes', async () => {
    const before = [sha(linksPdf.bytes), sha(secondPdf.bytes)];
    await buildPdf([linksPdf, secondPdf], [...pages('a', [6, 5, 4]), ...pages('b', [2])]);
    expect([sha(linksPdf.bytes), sha(secondPdf.bytes)]).toEqual(before);
    expect([sha(linksPdf.bytes), sha(secondPdf.bytes)]).toEqual([sha(fixture('links.pdf')), sha(fixture('second.pdf'))]);
  });

  it('merges two 600-page files in under 10 seconds, and splits one in under 10 seconds', async () => {
    const large: SourceInput = { id: 'l', name: 'large.pdf', bytes: fixture('large.pdf') };
    const large2: SourceInput = { ...large, id: 'm' };
    const all = Array.from({ length: 600 }, (_, i) => i + 1);
    let t = Date.now();
    const merged = await buildPdf([large, large2], [...pages('l', all), ...pages('m', all)]);
    const mergeMs = Date.now() - t;
    expect(merged.report.pages).toBe(1200);
    t = Date.now();
    for (let start = 1; start <= 600; start += 100) await buildPdf([large], pages('l', all.slice(start - 1, start + 99)));
    const splitMs = Date.now() - t;
    console.log(`merge 2 × 600 pages: ${mergeMs} ms; split 600 pages into 6 files: ${splitMs} ms`);
    expect(mergeMs).toBeLessThan(10_000);
    expect(splitMs).toBeLessThan(10_000);
  }, 60_000);
});
