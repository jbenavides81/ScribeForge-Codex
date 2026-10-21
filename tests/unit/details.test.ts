// Stop 1d: a file's details (in both places a PDF keeps them), what a file carries, and the
// details and layers of new files. Required checks: edited details read back the same from the
// classic details and XMP, the old values are found nowhere, and a file carrying one of each
// item shows every one.
import { describe, expect, it } from 'vitest';
import { buildPdf } from '../../src/engine/build';
import { inspectPdf } from '../../src/engine/inspect';
import type { PageItem, SourceInput } from '../../src/engine/types';
import { readXmp, splitKeywords, writeXmp } from '../../src/engine/xmp';
import { drawnText, findEverywhere, fixture, pageTexts, readerDetails, strayPages } from './support/inspect';

const source = (name: string, password?: string): SourceInput => ({ id: name, name, bytes: fixture(name), password });
const pages = (name: string, list: number[]): PageItem[] => list.map((n) => ({ kind: 'page', source: name, index: n - 1, rotate: 0 }));
const NOW = new Date('2026-10-19T15:30:00Z');

describe('XMP', () => {
  const wrap = (body: string, extra = '') =>
    `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"${extra}>${body}</rdf:RDF></x:xmpmeta>`;
  const DC = 'xmlns:dc="http://purl.org/dc/elements/1.1/"';

  it('reads values written as elements and as attributes, with XML escapes', () => {
    const read = readXmp(
      wrap(
        `<rdf:Description rdf:about="" ${DC}><dc:title><rdf:Alt><rdf:li xml:lang="fr">Titre</rdf:li><rdf:li xml:lang="x-default">Fish &amp; chips &lt;3 &#233;</rdf:li></rdf:Alt></dc:title>` +
          `<dc:creator><rdf:Seq><rdf:li>Ann</rdf:li><rdf:li>Bo</rdf:li></rdf:Seq></dc:creator>` +
          `<dc:subject><rdf:Bag><rdf:li>one</rdf:li><rdf:li>two</rdf:li></rdf:Bag></dc:subject></rdf:Description>` +
          `<rdf:Description rdf:about="" xmlns:pdf="http://ns.adobe.com/pdf/1.3/" pdf:Producer="Maker &quot;9&quot;"/>`,
      ),
    );
    expect(read).toEqual({ state: 'read', values: { title: 'Fish & chips <3 é', author: 'Ann; Bo', keywords: 'one, two', producer: 'Maker "9"' } });
  });

  it('follows whatever prefix the file uses for each kind of detail', () => {
    const read = readXmp(
      '<x:xmpmeta xmlns:x="adobe:ns:meta/"><r:RDF xmlns:r="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
        '<r:Description xmlns:d="http://purl.org/dc/elements/1.1/"><d:title><r:Alt><r:li xml:lang="x-default">Odd</r:li></r:Alt></d:title></r:Description>' +
        '</r:RDF></x:xmpmeta>',
    );
    expect(read).toEqual({ state: 'read', values: { title: 'Odd' } });
    // The usual prefix bound to something else isn't Dublin Core.
    expect(readXmp(wrap(`<rdf:Description xmlns:dc="urn:other"><dc:title>Not a title</dc:title></rdf:Description>`))).toEqual({ state: 'read', values: {} });
  });

  it('says when a packet is not XMP', () => {
    expect(readXmp('<x:xmpmeta><rdf:RDF><rdf:Description BROKEN')).toEqual({ state: 'unreadable' });
    expect(readXmp('just some text')).toEqual({ state: 'unreadable' });
  });

  it('writes a packet that reads back the same, including awkward characters', () => {
    const packet = writeXmp({
      title: 'Q3 <draft> & "notes" — ✓',
      author: 'Ann; Bo',
      subject: 'A subject\u0001 with a control character',
      keywords: 'one, two; three',
      producer: 'ScribeForge 0.4.0',
      creatorTool: 'Writer',
      created: new Date('2024-03-05T10:20:30Z'),
      modified: NOW,
    });
    expect(readXmp(packet)).toEqual({
      state: 'read',
      values: expect.objectContaining({
        title: 'Q3 <draft> & "notes" — ✓',
        author: 'Ann; Bo',
        subject: 'A subject with a control character',
        keywords: 'one, two; three',
        producer: 'ScribeForge 0.4.0',
        creatorTool: 'Writer',
      }),
    });
    expect(splitKeywords('one, two; three ,, ')).toEqual(['one', 'two', 'three']);
  });
});

describe('details and what a file carries', () => {
  it('a file carrying one of each item shows every one', async () => {
    const { details, carries } = await inspectPdf(source('carries.pdf'));
    expect(details.shown).toEqual({ title: 'CARRIES-OLD-TITLE', author: 'Fixture Author', subject: 'Fixture subject', keywords: 'alpha, beta' });
    expect(details.info).toMatchObject({ creator: 'Fixture Writer 1.0', producer: 'Fixture Maker 2.0' });
    expect(details.created).toBe('2024-03-05T10:20:30.000Z');
    expect(details.modified).toBe('2025-06-07T08:09:10.000Z');
    expect(details.xmp.state).toBe('read');
    expect(details.disagreements).toEqual([]);
    expect(details.version).toBe('1.7');
    expect(details.pageSizes).toEqual([
      { width: 612, height: 792, count: 1 },
      { width: 842, height: 595, count: 1 },
    ]);
    expect(details.encrypted).toBe(false);

    expect(carries.details.map((d) => d.key)).toEqual(['Title', 'Author', 'Subject', 'Keywords', 'Creator', 'Producer', 'CreationDate', 'ModDate', 'Company']);
    expect(carries.details.at(-1)?.value).toBe('Fixture Company Ltd');
    expect(carries.xmp).toBe('read');
    expect(carries.attachments).toEqual([
      { name: 'notes.txt', size: 22 },
      { name: 'page-file.txt', size: 20, page: 2 },
    ]);
    expect(carries.formFields).toEqual([
      { name: 'customer.name', filled: true },
      { name: 'agree', filled: false },
    ]);
    expect(carries.comments).toEqual({ total: 2, kinds: { Text: 1, Highlight: 1 }, authors: ['Fixture Author', 'Second Reviewer'] });
    expect(carries.actions).toEqual([
      { where: 'document', name: 'init', action: 'script' },
      { where: 'link', page: 2, action: 'launch' },
    ]);
    expect(carries.bookmarks).toBe(2);
    expect(carries.layers).toEqual([
      { name: 'Visible layer', hidden: false },
      { name: 'Hidden layer', hidden: true },
    ]);
    expect(carries.links).toEqual({ web: ['https://example.com/carries'], webLinks: 1, pages: 1, otherFiles: 0 });
    expect(carries.encrypted).toBe(false);
  });

  it('finds scripts wherever a file keeps them', async () => {
    const { carries } = await inspectPdf(source('scripted.pdf'));
    expect(carries.actions.map((a) => a.where).sort()).toEqual(['document', 'link', 'open', 'page']);
    expect(carries.actions.every((a) => a.action === 'script')).toBe(true);
  });

  it('notices when the two copies of the details disagree, and shows the classic one', async () => {
    const { details } = await inspectPdf(source('stale-xmp.pdf'));
    expect(details.disagreements).toEqual([{ field: 'title', info: 'Current title', xmp: 'STALE-XMP-TITLE' }]);
    expect(details.shown.title).toBe('Current title');
  });

  it('says when the XMP copy can’t be read', async () => {
    const { details, carries } = await inspectPdf(source('broken-xmp.pdf'));
    expect(details.xmp).toEqual({ state: 'unreadable' });
    expect(carries.xmp).toBe('unreadable');
    expect(details.shown.title).toBe('Broken XMP test');
  });

  it('knows a file is locked, whether it needs a password to open or not', async () => {
    expect((await inspectPdf(source('protected.pdf', 'open-sesame'))).details.encrypted).toBe(true);
    expect((await inspectPdf(source('owner-locked.pdf'))).details.encrypted).toBe(true);
    expect((await inspectPdf(source('normal.pdf'))).details.encrypted).toBe(false);
  });
});

describe('details of new files', () => {
  it('edited details read back the same from both copies, and the old ones are found nowhere', async () => {
    const edited = { title: 'New title', author: 'Pat Tester', subject: 'Quarterly figures', keywords: 'budget, 2026' };
    const { bytes } = await buildPdf([source('carries.pdf')], pages('carries.pdf', [1, 2]), [], { details: edited, producer: 'ScribeForge 0.4.0', now: NOW });

    // As another reader (pdf.js) sees them.
    const { info, xmp } = await readerDetails(bytes);
    expect(info).toMatchObject({ Title: 'New title', Author: 'Pat Tester', Subject: 'Quarterly figures', Keywords: 'budget, 2026' });
    expect(info).toMatchObject({ Creator: 'Fixture Writer 1.0', Producer: 'ScribeForge 0.4.0', CreationDate: 'D:20240305102030Z', ModDate: 'D:20261019153000Z' });
    expect(xmp).toMatchObject({ 'dc:title': 'New title', 'dc:creator': ['Pat Tester'], 'dc:description': 'Quarterly figures', 'dc:subject': ['budget', '2026'] });

    // As ScribeForge sees them: both copies agree.
    const { details } = await inspectPdf({ id: 'out', name: 'out.pdf', bytes });
    expect(details.disagreements).toEqual([]);
    expect(details.xmp).toEqual({ state: 'read', values: expect.objectContaining({ ...edited, producer: 'ScribeForge 0.4.0', creatorTool: 'Fixture Writer 1.0' }) });

    for (const old of ['CARRIES-OLD-TITLE', 'Fixture subject', 'alpha, beta', 'Fixture Maker 2.0', 'Fixture Company Ltd']) {
      expect(await findEverywhere(bytes, old), old).toEqual([]);
    }
    expect(await strayPages(bytes)).toBe(0);
  });

  it('without edits, the classic details are written to both copies, replacing stale or unreadable XMP', async () => {
    const stale = (await buildPdf([source('stale-xmp.pdf')], pages('stale-xmp.pdf', [1]))).bytes;
    expect((await readerDetails(stale)).xmp).toMatchObject({ 'dc:title': 'Current title' });
    expect(await findEverywhere(stale, 'STALE-XMP-TITLE')).toEqual([]);

    const broken = (await buildPdf([source('broken-xmp.pdf')], pages('broken-xmp.pdf', [1]))).bytes;
    expect((await readerDetails(broken)).xmp).toMatchObject({ 'dc:title': 'Broken XMP test' });
    expect(await findEverywhere(broken, 'BROKEN-XMP-TEXT')).toEqual([]);
  });

  it('a hidden layer stays hidden in the new file, alone or merged', async () => {
    const before = await drawnText(fixture('carries.pdf'), 1);
    expect(before).toContain('VISIBLE-LAYER-TEXT');
    expect(before).not.toContain('HIDDEN-LAYER-TEXT');

    const alone = (await buildPdf([source('carries.pdf')], pages('carries.pdf', [1]))).bytes;
    expect(await drawnText(alone, 1)).toContain('VISIBLE-LAYER-TEXT');
    expect(await drawnText(alone, 1)).not.toContain('HIDDEN-LAYER-TEXT');

    const merged = (await buildPdf([source('links.pdf'), source('carries.pdf')], [...pages('links.pdf', [1]), ...pages('carries.pdf', [1])])).bytes;
    expect(await drawnText(merged, 2)).toContain('VISIBLE-LAYER-TEXT');
    expect(await drawnText(merged, 2)).not.toContain('HIDDEN-LAYER-TEXT');
    expect((await inspectPdf({ id: 'm', name: 'm.pdf', bytes: merged })).carries.layers).toEqual([
      { name: 'Visible layer', hidden: false },
      { name: 'Hidden layer', hidden: true },
    ]);
  });

  it('what a new file carries: no scripts or form fields; comments, bookmarks and page attachments stay', async () => {
    const { bytes, report } = await buildPdf([source('carries.pdf')], pages('carries.pdf', [1, 2]));
    expect(report.actionsRemoved).toBe(2); // the document script and the "open a program" link
    expect(report.attachmentsLeftOut).toBe(1); // notes.txt, attached to the whole document
    const { carries } = await inspectPdf({ id: 'out', name: 'out.pdf', bytes });
    expect(carries.actions).toEqual([]);
    expect(carries.formFields).toEqual([]);
    expect(carries.attachments).toEqual([{ name: 'page-file.txt', size: 20, page: 2 }]);
    expect(carries.comments.total).toBe(2);
    expect(carries.bookmarks).toBe(2);
    expect(carries.links).toEqual({ web: ['https://example.com/carries'], webLinks: 1, pages: 1, otherFiles: 0 });
    expect(await findEverywhere(bytes, 'ATTACHMENT-SECRET-TEXT')).toEqual([]);
  });

  it('pages from a file locked only against changes can be saved (it opens without a password)', async () => {
    const { bytes } = await buildPdf([source('owner-locked.pdf')], pages('owner-locked.pdf', [1]));
    expect((await pageTexts(bytes))[0]).toContain('OWNER-LOCKED-PAGE');
    expect((await inspectPdf({ id: 'out', name: 'out.pdf', bytes })).details.encrypted).toBe(false);
  });
});
