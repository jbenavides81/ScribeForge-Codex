// The plain words the Details screen and the before-save list use.
import { describe, expect, it } from 'vitest';
import type { Carries } from '../../src/engine/types';
import { actionText, combineCarries, commentKinds, pageSize, restrictions, sizeText } from '../../src/renderer/src/details/describe';
import { buildNotes } from '../../src/renderer/src/pages/report';

describe('page sizes', () => {
  it('names common paper sizes, upright or sideways, in inches', () => {
    expect(pageSize(612, 792)).toBe('8.5 × 11 in (Letter)');
    expect(pageSize(792, 612)).toBe('11 × 8.5 in (Letter, sideways)');
    expect(pageSize(595.28, 841.89)).toBe('8.27 × 11.69 in (A4)');
    expect(pageSize(612, 1008)).toBe('8.5 × 14 in (Legal)');
    expect(pageSize(300, 300)).toBe('4.17 × 4.17 in');
  });
});

describe('comments and actions', () => {
  it('counts comments by kind, in plain words', () => {
    expect(commentKinds({ Text: 2, Highlight: 1 })).toBe('2 notes and 1 highlight');
    expect(commentKinds({ Square: 1, Circle: 2, FreeText: 1, Redact: 1 })).toBe('3 shapes, 1 text box and 1 redaction mark, not applied');
    expect(commentKinds({ Mystery: 1 })).toBe('1 other mark');
    expect(commentKinds({})).toBe('');
  });

  it('says what each risky action does and where it is', () => {
    expect(actionText({ where: 'open', action: 'script' })).toBe('Script: when the file opens');
    expect(actionText({ where: 'document', name: 'init', action: 'script' })).toBe('Script: document script "init"');
    expect(actionText({ where: 'link', page: 2, action: 'launch' })).toBe('Opens a program or file: link on page 2');
    expect(actionText({ where: 'page', page: 3, event: 'close', action: 'script' })).toBe('Script: when page 3 closes');
    expect(actionText({ where: 'field', name: 'total', page: 1, action: 'submit' })).toBe('Sends form data: form field "total" on page 1');
    expect(actionText({ where: 'document-event', event: 'WP', action: 'script' })).toBe('Script: before printing');
    expect(actionText({ where: 'bookmark', title: 'Intro', action: 'other-file' })).toBe('Opens another file: bookmark "Intro"');
  });
});

describe('restrictions and sizes', () => {
  it('lists what a locked file doesn’t allow', () => {
    expect(restrictions(null)).toEqual([]);
    expect(restrictions([4, 2048, 16, 8, 32, 256, 1024])).toEqual([]);
    expect(restrictions([4, 2048, 256])).toEqual(['copying text and images', 'changing the document', 'adding or changing comments', 'inserting, deleting or turning pages']);
  });

  it('gives file sizes in bytes, KB or MB', () => {
    expect(sizeText(1)).toBe('1 byte');
    expect(sizeText(900)).toBe('900 bytes');
    expect(sizeText(20_480)).toBe('20 KB');
    expect(sizeText(3_500_000)).toBe('3.3 MB');
    expect(sizeText(undefined)).toBe('');
  });
});

describe('several new files', () => {
  const part = (over: Partial<Carries>): Carries => ({
    details: [{ key: 'Title', value: 'T' }],
    xmp: 'read',
    attachments: [],
    formFields: [],
    comments: { total: 0, kinds: {}, authors: [] },
    actions: [],
    bookmarks: 0,
    layers: [],
    links: { web: [], webLinks: 0, pages: 0, otherFiles: 0 },
    encrypted: false,
    ...over,
  });

  it('adds up what split files carry', () => {
    const together = combineCarries([
      part({ comments: { total: 2, kinds: { Text: 2 }, authors: ['Bo'] }, bookmarks: 1, links: { web: ['https://a.example'], webLinks: 1, pages: 0, otherFiles: 0 } }),
      part({
        comments: { total: 1, kinds: { Text: 1 }, authors: ['Ann', 'Bo'] },
        bookmarks: 2,
        layers: [{ name: 'Draft', hidden: true }],
        links: { web: ['https://a.example'], webLinks: 2, pages: 1, otherFiles: 0 },
      }),
    ]);
    expect(together.comments).toEqual({ total: 3, kinds: { Text: 3 }, authors: ['Ann', 'Bo'] });
    expect(together.bookmarks).toBe(3);
    expect(together.layers).toEqual([{ name: 'Draft', hidden: true }]);
    expect(together.links).toEqual({ web: ['https://a.example'], webLinks: 3, pages: 1, otherFiles: 0 });
  });
});

describe('what saving left out', () => {
  it('explains each thing in a sentence', () => {
    const report = { pages: 2, linksKept: 0, linksRemoved: 1, bookmarksKept: 0, bookmarksRemoved: 0, formFieldsDetached: 1, actionsRemoved: 2, strayReferencesCut: 0, objectsSwept: 0, annotationsAdded: 0, annotationsLeftOut: 0, attachmentsLeftOut: 2 };
    expect(buildNotes(report)).toEqual([
      "1 link and 0 bookmarks pointed to pages that aren't in the new file, so they were left out.",
      "Form fields look the same but can't be filled in, in the new file.",
      'Scripts and other actions were removed.',
      "2 files attached to the whole document aren't copied into the new file.",
    ]);
  });
});
