// Stop 2a's checks for the command-line tool, run in Node: which words start it, how each command
// is read, and every command run end to end with the same engine the app uses. Redaction draws its
// pages with the app's own code and Node's canvas, as the hidden window does with the browser's.
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { degrees, PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildPdf } from '../../src/engine/build';
import type { PageItem } from '../../src/engine/types';
import { commandWords, parseArea, parseCommand, type Command } from '../../src/main/cli/args';
import { EXIT, firstLineOf, runCommand, type CliIo } from '../../src/main/cli/run';
import { redactionPages, type PdfPages } from '../../src/renderer/src/cli/redactionPages';
import type { MakeSurface } from '../../src/renderer/src/redact/burn';
import type { RenderJob } from '../../src/shared/cli';
import { bookmarks, FIXTURES, findEverywhere, links, pageIds, pageTexts, readerDetails, ROOT, rotations } from './support/inspect';

const TERM = 'REDACT-ME-TERM';
const PASSWORD = 'open-sesame';
const FONTS = `${path.join(ROOT, 'node_modules/pdfjs-dist/standard_fonts').replace(/\\/g, '/')}/`;
const API = { OPS: pdfjs.OPS as unknown as Record<string, number>, annotationsOff: pdfjs.AnnotationMode.DISABLE };
const sha = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
const bytesOf = (file: string) => new Uint8Array(readFileSync(file));

const nodeSurface: MakeSurface = (width, height) => {
  const canvas = createCanvas(width, height);
  return {
    canvas: canvas as unknown as HTMLCanvasElement,
    context: canvas.getContext('2d') as unknown as CanvasRenderingContext2D,
    png: async () => new Uint8Array(canvas.encodeSync('png')),
  };
};

/** What the hidden window does, in Node. */
async function nodeRender(job: RenderJob) {
  const doc = await pdfjs.getDocument({ data: job.bytes.slice(), password: job.password, standardFontDataUrl: FONTS, useWorkerFetch: false, verbosity: 0 }).promise;
  try {
    return await redactionPages(doc as unknown as PdfPages, job, API, nodeSurface);
  } finally {
    await doc.loadingTask.destroy();
  }
}

/** A folder with copies of the test PDFs, and a console that records what's printed. */
let dir: string;
let printed: { out: string[]; err: string[] };
let asked: { fileName: string; retry: boolean }[];

function io(over: Partial<CliIo> = {}): CliIo {
  return {
    cwd: dir,
    version: '1.1.0',
    out: (line) => printed.out.push(line),
    err: (line) => printed.err.push(line),
    stdinLine: async () => null,
    askPassword: async (fileName, retry) => {
      asked.push({ fileName, retry });
      return null;
    },
    render: nodeRender,
    ...over,
  };
}

/** Parses the words and runs them, as ScribeForge.exe does. */
async function run(words: string[], over: Partial<CliIo> = {}): Promise<number> {
  const parsed = parseCommand(words);
  if (!parsed.ok) throw new Error(`didn't parse: ${parsed.error}`);
  return runCommand(parsed.command, io(over));
}

const at = (name: string) => path.join(dir, name);

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'scribeforge-cli-test-'));
  for (const name of readdirSync(FIXTURES)) copyFileSync(path.join(FIXTURES, name), at(name));
  printed = { out: [], err: [] };
  asked = [];
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('which words start the command-line tool', () => {
  it('a command after the program starts it; anything else opens the app', () => {
    expect(commandWords(['C:\\Apps\\ScribeForge.exe', 'merge', 'a.pdf', 'b.pdf'], false)).toEqual(['merge', 'a.pdf', 'b.pdf']);
    expect(commandWords(['C:\\Apps\\ScribeForge.exe', 'C:\\Docs\\report.pdf'], false)).toBeNull();
    expect(commandWords(['C:\\Apps\\ScribeForge.exe'], false)).toBeNull();
    expect(commandWords(['C:\\Apps\\ScribeForge.exe', '--version'], false)).toEqual(['--version']);
  });

  it('in development, the app folder comes first; switches added by test tools are skipped', () => {
    expect(commandWords(['electron.exe', 'C:\\repo', 'info', 'x.pdf'], true)).toEqual(['info', 'x.pdf']);
    expect(commandWords(['electron.exe', '--inspect=0', '--remote-debugging-port=0', 'C:\\repo', 'info', 'x.pdf'], true)).toEqual(['info', 'x.pdf']);
    expect(commandWords(['ScribeForge.exe', '--inspect=0', '--remote-debugging-port=0', 'split', 'x.pdf'], false)).toEqual(['split', 'x.pdf']);
    expect(commandWords(['electron.exe', 'C:\\repo'], true)).toBeNull();
  });

  it('the launcher always starts it, so a mistyped command gets a message rather than the app', () => {
    expect(commandWords(['ScribeForge.exe', '--cli', 'mreg', 'a.pdf'], false)).toEqual(['mreg', 'a.pdf']);
    expect(commandWords(['ScribeForge.exe', '--cli'], false)).toEqual([]);
    expect(parseCommand(['mreg', 'a.pdf'])).toEqual({ ok: false, error: '"mreg" isn\'t a ScribeForge command.' });
    expect(parseCommand([])).toEqual({ ok: true, command: { name: 'help' } });
  });
});

describe('reading a command', () => {
  const ok = (words: string[]): Command => {
    const parsed = parseCommand(words);
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.command;
  };
  const error = (words: string[]): string => {
    const parsed = parseCommand(words);
    if (parsed.ok) throw new Error('expected a problem');
    return parsed.error;
  };

  it('help and version', () => {
    expect(ok(['--version'])).toEqual({ name: 'version' });
    expect(ok(['--help'])).toEqual({ name: 'help' });
    expect(ok(['help', 'redact'])).toEqual({ name: 'help', topic: 'redact' });
    expect(ok(['merge', '--help'])).toEqual({ name: 'help', topic: 'merge' });
  });

  it('each command with its options', () => {
    expect(ok(['merge', 'a.pdf', 'b.pdf', 'c.pdf', '-o', 'all.pdf', '--overwrite'])).toEqual({
      name: 'merge',
      inputs: ['a.pdf', 'b.pdf', 'c.pdf'],
      output: 'all.pdf',
      overwrite: true,
      passwordStdin: false,
    });
    expect(ok(['split', 'a.pdf', '--every', '5'])).toMatchObject({ name: 'split', input: 'a.pdf', every: 5 });
    expect(ok(['split', 'a.pdf', '--ranges', '1-3, 4'])).toMatchObject({ name: 'split', ranges: '1-3, 4' });
    expect(ok(['rotate', 'a.pdf'])).toMatchObject({ name: 'rotate', pages: 'all', by: 90 });
    expect(ok(['rotate', 'a.pdf', '--pages', '2,4', '--by', '180'])).toMatchObject({ pages: '2,4', by: 180 });
    expect(ok(['extract', 'a.pdf', '--pages', '1-3'])).toMatchObject({ name: 'extract', pages: '1-3' });
    expect(ok(['info', 'a.pdf', '--json', '--password-stdin'])).toMatchObject({ name: 'info', json: true, passwordStdin: true });
    expect(ok(['details', 'a.pdf', '--title', 'Q3', '--keywords', 'x, y'])).toMatchObject({ name: 'details', set: { title: 'Q3', keywords: 'x, y' } });
    expect(ok(['redact', 'a.pdf', '--find', 'Smith', '--find', 'Jones', '--area', '1:1,2,3,4', '--dpi', '300'])).toMatchObject({
      name: 'redact',
      find: ['Smith', 'Jones'],
      areas: ['1:1,2,3,4'],
      dpi: 300,
    });
    expect(ok(['redact', 'a.pdf', '--pages', '2'])).toMatchObject({ pages: '2', dpi: 200, areas: [], find: [] });
  });

  it('a negative turn is a value, not another option', () => {
    expect(ok(['rotate', 'a.pdf', '--by', '-90'])).toMatchObject({ by: 270 });
    expect(ok(['rotate', 'a.pdf', '--by=-90'])).toMatchObject({ by: 270 });
    expect(ok(['rotate', 'a.pdf', '--by', '450'])).toMatchObject({ by: 90 });
  });

  it('mistakes get a plain message', () => {
    expect(error(['merge', 'a.pdf'])).toMatch(/at least two PDFs/);
    expect(error(['split'])).toMatch(/Say which PDF/);
    expect(error(['split', 'a.pdf', 'b.pdf'])).toMatch(/one PDF at a time; it was given 2/);
    expect(error(['split', 'a.pdf', '--every', '2', '--ranges', '1'])).toMatch(/either --every or --ranges/);
    expect(error(['split', 'a.pdf', '--every', '0'])).toMatch(/whole number/);
    expect(error(['rotate', 'a.pdf', '--by', '45'])).toMatch(/90, 180 or 270/);
    expect(error(['rotate', 'a.pdf', '--by'])).toBe('"--by" needs a value after it.');
    expect(error(['extract', 'a.pdf'])).toMatch(/Say which pages/);
    expect(error(['info', 'a.pdf', '-o', 'x.pdf'])).toMatch(/doesn't save a file/);
    expect(error(['details', 'a.pdf'])).toMatch(/Say which details/);
    expect(error(['redact', 'a.pdf'])).toMatch(/Say what to redact/);
    expect(error(['redact', 'a.pdf', '--pages', '1', '--dpi', '600'])).toMatch(/150, 200 or 300/);
    expect(error(['redact', 'a.pdf', '--area', '1:5,5'])).toMatch(/isn't an area/);
    expect(error(['merge', 'a.pdf', 'b.pdf', '--bogus'])).toBe('"--bogus" isn\'t something "merge" understands.');
    expect(error(['merge', 'a.pdf', 'b.pdf', '--pages', '1'])).toBe('"--pages" isn\'t something "merge" understands.');
    expect(error(['info', 'a.pdf', '--json=yes'])).toBe('"--json" doesn\'t take a value.');
    // The message says which command's help to show.
    expect(parseCommand(['merge', 'a.pdf'])).toMatchObject({ ok: false, topic: 'merge' });
  });

  it('areas are page, left, top, right, bottom, in points or millimetres', () => {
    expect(parseArea('2:72,600,300,640')).toEqual({ page: 2, left: 72, top: 600, right: 300, bottom: 640 });
    const mm = parseArea('1:25.4, 0, 50.8, 10mm');
    expect(mm).toMatchObject({ page: 1, left: 72, top: 0, right: 144 });
    expect((mm as { bottom: number }).bottom).toBeCloseTo(28.35, 2);
    expect(parseArea('0:1,2,3,4')).toBe('Pages are numbered from 1.');
    expect(parseArea('1:10,10,5,20')).toMatch(/right must be more than left/);
  });

  it('a password from standard input is its first line, without a byte-order mark', () => {
    expect(firstLineOf('open-sesame\r\nmore')).toBe('open-sesame');
    expect(firstLineOf('\uFEFFopen-sesame\r\n')).toBe('open-sesame');
    expect(firstLineOf('no line ending')).toBe('no line ending');
    expect(firstLineOf('')).toBeNull();
    expect(firstLineOf('\uFEFF')).toBeNull();
  });
});

describe('running the commands', () => {
  const pages = (source: string, list: number[], rotate: (i: number) => 0 | 90 | 180 | 270 = () => 0): PageItem[] =>
    list.map((index) => ({ kind: 'page', source, index, rotate: rotate(index) }));

  it('merge saves next to the first PDF, named as the app names it, and matches the app', async () => {
    const before = [sha(at('links.pdf')), sha(at('second.pdf'))];
    expect(await run(['merge', 'links.pdf', 'second.pdf'])).toBe(EXIT.done);
    const out = at('links (merged).pdf');
    expect(printed.out[0]).toBe(`Saved ${out} (8 pages).`);
    expect(await pageIds(bytesOf(out))).toEqual([1, 2, 3, 4, 5, 6].map((n) => `UNIQUE-PAGE-${n}`).concat(['SECOND-DOC-PAGE-1', 'SECOND-DOC-PAGE-2']));

    // The same job done the way the app does it.
    const a = { id: 's1', name: 'links.pdf', bytes: bytesOf(at('links.pdf')) };
    const b = { id: 's2', name: 'second.pdf', bytes: bytesOf(at('second.pdf')) };
    const app = await buildPdf([a, b], [...pages('s1', [0, 1, 2, 3, 4, 5]), ...pages('s2', [0, 1])], [], { producer: 'ScribeForge 1.1.0' });
    expect(await pageTexts(bytesOf(out))).toEqual(await pageTexts(app.bytes));
    expect(await bookmarks(bytesOf(out))).toEqual(await bookmarks(app.bytes));
    expect(await links(bytesOf(out))).toEqual(await links(app.bytes));
    expect((await links(bytesOf(out))).length).toBeGreaterThan(0);
    expect((await bookmarks(bytesOf(out))).length).toBeGreaterThan(0);
    expect([sha(at('links.pdf')), sha(at('second.pdf'))]).toEqual(before);
  });

  it('never replaces a file unless asked, and never writes over an input', async () => {
    expect(await run(['merge', 'normal.pdf', 'second.pdf'])).toBe(EXIT.done);
    expect(await run(['merge', 'normal.pdf', 'second.pdf'])).toBe(EXIT.done);
    expect(existsSync(at('normal (merged) 2.pdf'))).toBe(true);

    writeFileSync(at('taken.pdf'), 'keep me');
    expect(await run(['merge', 'normal.pdf', 'second.pdf', '-o', 'taken.pdf'])).toBe(EXIT.file);
    expect(printed.err.at(-1)).toBe('taken.pdf already exists. Add --overwrite to replace it, or choose another name.');
    expect(readFileSync(at('taken.pdf'), 'utf8')).toBe('keep me');
    expect(await run(['merge', 'normal.pdf', 'second.pdf', '-o', 'taken.pdf', '--overwrite'])).toBe(EXIT.done);
    expect(await pageIds(bytesOf(at('taken.pdf')))).toHaveLength(5);

    const before = sha(at('normal.pdf'));
    for (const words of [
      ['merge', 'normal.pdf', 'second.pdf', '-o', 'NORMAL.PDF', '--overwrite'],
      ['rotate', 'normal.pdf', '-o', './normal.pdf', '--overwrite'],
      ['details', 'normal.pdf', '--title', 'x', '-o', path.join(dir, 'normal.pdf'), '--overwrite'],
      ['redact', 'normal.pdf', '--pages', '1', '-o', 'normal.pdf', '--overwrite'],
    ]) {
      expect(await run(words)).toBe(EXIT.command);
      expect(printed.err.at(-1)).toMatch(/is one of the files being read. ScribeForge never writes over the files it reads/);
    }
    expect(sha(at('normal.pdf'))).toBe(before);

    expect(await run(['extract', 'normal.pdf', '--pages', '1', '-o', 'notes.txt'])).toBe(EXIT.command);
    expect(await run(['extract', 'normal.pdf', '--pages', '1', '-o', 'nowhere/x.pdf'])).toBe(EXIT.file);
    expect(printed.err.at(-1)).toMatch(/doesn't exist/);
  });

  it('split makes one file per page, every N pages, or the ranges given, into a folder', async () => {
    expect(await run(['split', 'links.pdf'])).toBe(EXIT.done);
    for (const n of [1, 2, 3, 4, 5, 6]) expect(await pageIds(bytesOf(at(`links (page ${n}).pdf`)))).toEqual([`UNIQUE-PAGE-${n}`]);

    expect(await run(['split', 'links.pdf', '--ranges', '1-2, 3', '-o', 'parts'])).toBe(EXIT.done);
    expect(readdirSync(at('parts')).sort()).toEqual(['links (page 3).pdf', 'links (pages 1-2).pdf']);
    expect(printed.out.at(-3)).toBe(`Split into 2 files in ${at('parts')}:`);
    expect(await pageIds(bytesOf(at('parts/links (pages 1-2).pdf')))).toEqual(['UNIQUE-PAGE-1', 'UNIQUE-PAGE-2']);

    // The same names again get a number, never replacing what's there.
    expect(await run(['split', 'links.pdf', '--every', '2', '-o', 'parts'])).toBe(EXIT.done);
    expect(readdirSync(at('parts')).sort()).toEqual([
      'links (page 3).pdf',
      'links (pages 1-2) 2.pdf',
      'links (pages 1-2).pdf',
      'links (pages 3-4).pdf',
      'links (pages 5-6).pdf',
    ]);

    expect(await run(['split', 'links.pdf', '-o', 'second.pdf'])).toBe(EXIT.command);
    expect(await run(['split', 'links.pdf', '--ranges', '2-9'])).toBe(EXIT.command);
    expect(printed.err.at(-1)).toBe('"2-9" goes past the last page, which is page 6.');
  });

  it('rotate turns the pages listed, or all of them', async () => {
    expect(await run(['rotate', 'normal.pdf', '--pages', '1, 3', '--by', '-90', '-o', 'turned.pdf'])).toBe(EXIT.done);
    expect(await rotations(bytesOf(at('turned.pdf')))).toEqual([270, 0, 270]);
    expect(await run(['rotate', 'normal.pdf'])).toBe(EXIT.done);
    expect(await rotations(bytesOf(at('normal (edited).pdf')))).toEqual([90, 90, 90]);
    expect(await run(['rotate', 'normal.pdf', '--pages', '4'])).toBe(EXIT.command);
  });

  it('extract keeps just the pages listed, in that order', async () => {
    expect(await run(['extract', 'links.pdf', '--pages', '3, 1', '-o', 'two.pdf'])).toBe(EXIT.done);
    expect(await pageIds(bytesOf(at('two.pdf')))).toEqual(['UNIQUE-PAGE-3', 'UNIQUE-PAGE-1']);
    expect(await run(['extract', 'normal.pdf', '--pages', '2'])).toBe(EXIT.done);
    expect(existsSync(at('normal (page 2).pdf'))).toBe(true);
  });

  it('info shows the details and what the file carries, or JSON for scripts', async () => {
    expect(await run(['info', 'carries.pdf'])).toBe(EXIT.done);
    const text = printed.out.join('\n');
    for (const heading of ['carries.pdf', 'Details', 'About this file', 'What it carries', 'Attached files:', 'Form fields:', 'Scripts and actions:', 'Layers:', 'Links:']) {
      expect(text).toContain(heading);
    }
    printed.out = [];
    expect(await run(['info', 'carries.pdf', '--json'])).toBe(EXIT.done);
    const json = JSON.parse(printed.out.join('\n'));
    expect(json.file).toBe(at('carries.pdf'));
    expect(json.details.pageCount).toBeGreaterThan(0);
    expect(json.carries.attachments.length).toBeGreaterThan(0);
  });

  it('details sets both copies of the details, keeping the ones not given', async () => {
    expect(await run(['details', 'normal.pdf', '--title', 'Quarterly report', '--author', 'Ana Ruiz', '-o', 'titled.pdf'])).toBe(EXIT.done);
    const { info, xmp } = await readerDetails(bytesOf(at('titled.pdf')));
    expect(info).toMatchObject({ Title: 'Quarterly report', Author: 'Ana Ruiz', Producer: 'ScribeForge 1.1.0' });
    expect(xmp).toMatchObject({ 'dc:title': 'Quarterly report', 'dc:creator': ['Ana Ruiz'] });
    const source = await readerDetails(bytesOf(at('normal.pdf')));
    if (source.info.Subject) expect(info.Subject).toBe(source.info.Subject);
  });

  it('redact by search passes the Phase 1 redaction check: the test term is found nowhere', async () => {
    const before = sha(at('redaction.pdf'));
    expect(await run(['redact', 'redaction.pdf', '--find', TERM, '--find', 'not in this file'])).toBe(EXIT.done);
    const out = bytesOf(at('redaction (redacted).pdf'));
    expect(await findEverywhere(out, TERM)).toEqual([]);
    const texts = await pageTexts(out);
    expect(texts[0]).toContain('UNMARKED-PAGE-ONE');
    expect(texts.slice(1)).toEqual(['', '']);
    expect(printed.out).toEqual([
      '"not in this file" wasn\'t found.',
      `Saved ${at('redaction (redacted).pdf')} (3 pages, 2 pages redacted).`,
      "4 marks on 2 pages are blacked out. Those pages are now pictures (200 dpi): their text can't be selected, searched or copied.",
      'Left out, as in every redacted file: the document\'s details (title, author and so on), 1 comment, 1 bookmark, 1 attached file, 1 script or action, and any annotations you added.',
    ]);
    expect(sha(at('redaction.pdf'))).toBe(before);
  });

  it('redact by page and by area; only marked pages become pictures', async () => {
    expect(await run(['redact', 'redaction.pdf', '--pages', '2', '--area', '3:0,0,100,50', '--dpi', '150', '-o', 'r.pdf'])).toBe(EXIT.done);
    const texts = await pageTexts(bytesOf(at('r.pdf')));
    expect(texts[0]).toContain('UNMARKED-PAGE-ONE');
    expect(texts.slice(1)).toEqual(['', '']);
    expect(printed.out[1]).toBe("2 marks on 2 pages are blacked out. Those pages are now pictures (150 dpi): their text can't be selected, searched or copied.");
  });

  it('redact says when nothing was marked, and saves nothing', async () => {
    expect(await run(['redact', 'normal.pdf', '--find', 'no such words'])).toBe(EXIT.command);
    expect(printed.out).toEqual(['"no such words" wasn\'t found.']);
    expect(printed.err).toEqual(['Nothing was marked, so nothing was redacted.']);
    expect(existsSync(at('normal (redacted).pdf'))).toBe(false);
    expect(await run(['redact', 'normal.pdf', '--area', '9:0,0,10,10'])).toBe(EXIT.command);
    expect(printed.err.at(-1)).toBe('normal.pdf has no page 9; it has 3 pages.');
  });

  it("redact's last check fails with exit code 3 and saves nothing when a term is still in the file", async () => {
    // A drawing that claims to have marked the term but blacked out nothing.
    const careless = async (job: RenderJob) => ({ ...(await nodeRender({ ...job, find: [] })), matches: { [TERM]: 1 }, marks: 1 });
    expect(await run(['redact', 'redaction.pdf', '--find', TERM, '--pages', '1'], { render: careless })).toBe(EXIT.check);
    expect(printed.err.at(-1)).toMatch(/still found "REDACT-ME-TERM", so nothing was saved/);
    expect(existsSync(at('redaction (redacted).pdf'))).toBe(false);
  });

  it('passwords: from standard input, or asked for in a window, never stored', async () => {
    expect(await run(['info', 'protected.pdf', '--password-stdin'], { stdinLine: async () => PASSWORD })).toBe(EXIT.done);
    expect(asked).toEqual([]);

    expect(await run(['info', 'protected.pdf', '--password-stdin'], { stdinLine: async () => 'wrong' })).toBe(EXIT.file);
    expect(printed.err.at(-1)).toBe("That password didn't work for protected.pdf.");
    expect(await run(['info', 'protected.pdf', '--password-stdin'])).toBe(EXIT.file);
    expect(printed.err.at(-1)).toBe('protected.pdf needs a password, and none came on standard input.');

    // In a window: a wrong password asks again, saying so; Cancel stops.
    const answers = ['wrong', PASSWORD];
    const window = async (fileName: string, retry: boolean) => {
      asked.push({ fileName, retry });
      return answers.shift() ?? null;
    };
    expect(await run(['extract', 'protected.pdf', '--pages', '1', '-o', 'p1.pdf'], { askPassword: window })).toBe(EXIT.done);
    expect(asked).toEqual([
      { fileName: 'protected.pdf', retry: false },
      { fileName: 'protected.pdf', retry: true },
    ]);
    expect((await pageTexts(bytesOf(at('p1.pdf'))))[0]).toContain('Protected test document');

    asked = [];
    expect(await run(['info', 'protected.pdf'])).toBe(EXIT.file);
    expect(printed.err.at(-1)).toBe('protected.pdf needs a password, and none was given.');

    // Redacting a protected file draws its pages with the same password.
    expect(await run(['redact', 'protected.pdf', '--pages', '1', '--password-stdin'], { stdinLine: async () => PASSWORD })).toBe(EXIT.done);

    // A file locked only against changes opens without asking.
    asked = [];
    expect(await run(['extract', 'owner-locked.pdf', '--pages', '1', '-o', 'o.pdf'])).toBe(EXIT.done);
    expect(asked).toEqual([]);
  });

  it('one password from standard input serves every protected file in a merge', async () => {
    let reads = 0;
    const stdinLine = async () => {
      reads++;
      return PASSWORD;
    };
    expect(await run(['merge', 'protected.pdf', 'normal.pdf', 'protected.pdf', '-o', 'm.pdf', '--password-stdin'], { stdinLine })).toBe(EXIT.done);
    expect(reads).toBe(1);
  });

  it('missing, wrong and damaged files get a plain message and exit code 2', async () => {
    writeFileSync(at('notes.txt'), 'hello');
    mkdirSync(at('folder.pdf'));
    const cases: [string, RegExp][] = [
      ['missing.pdf', /^missing\.pdf couldn't be found\.$/],
      ['notes.txt', /^notes\.txt isn't a PDF file/],
      ['folder.pdf', /^folder\.pdf couldn't be found\.$/],
      ['not-a-pdf.pdf', /^not-a-pdf\.pdf isn't really a PDF, or it's damaged\.$/],
    ];
    for (const [file, message] of cases) {
      expect(await run(['info', file])).toBe(EXIT.file);
      expect(printed.err.at(-1)).toMatch(message);
    }
    // Damaged files either open (pdf-lib repairs what it can) or say so; they never crash the tool.
    for (const file of ['damaged-truncated.pdf', 'damaged-xref.pdf']) {
      const code = await run(['extract', file, '--pages', '1', '-o', `${file}-out.pdf`]);
      expect([EXIT.done, EXIT.command, EXIT.file]).toContain(code);
      if (code !== EXIT.done) expect(printed.err.at(-1)).not.toMatch(/Something went wrong/);
    }
  });

  it('help and version', async () => {
    expect(await run(['--version'])).toBe(EXIT.done);
    expect(printed.out).toEqual(['ScribeForge 1.1.0']);
    expect(await run(['help'])).toBe(EXIT.done);
    expect(printed.out[1]).toMatch(/^ScribeForge, from the command line\./);
    expect(await run(['help', 'redact'])).toBe(EXIT.done);
    expect(printed.out[2]).toMatch(/^scribeforge redact report\.pdf/);
  });
});

describe('what redact marks', () => {
  /** The colour of a pixel of a drawn page, at a point measured in the page's own space. */
  async function pixelAt(png: Uint8Array, view: number[], dpi: number, x: number, y: number): Promise<number[]> {
    const image = await loadImage(Buffer.from(png));
    const canvas = createCanvas(image.width, image.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    const scale = dpi / 72;
    return [...ctx.getImageData(Math.floor((x - view[0]) * scale), Math.floor((view[3] - y) * scale), 1, 1).data];
  }
  const BLACK = [0, 0, 0, 255];
  const WHITE = [255, 255, 255, 255];

  async function onePage(rotate: number): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    page.drawText('Corner', { x: 20, y: 20, size: 12, font: await doc.embedFont(StandardFonts.Helvetica) });
    page.setRotation(degrees(rotate));
    return doc.save();
  }

  it('an area is measured from the top-left corner of the page as it is shown', async () => {
    const job = { dpi: 72, wholePages: [], areas: [{ page: 1, left: 0, top: 0, right: 100, bottom: 50 }], find: [] };
    // Upright: the top-left of the page in its own space.
    const upright = await nodeRender({ ...job, bytes: await onePage(0) });
    expect(upright.marks).toBe(1);
    expect(await pixelAt(upright.pages[0].png, upright.pages[0].view, 72, 50, 770)).toEqual(BLACK);
    expect(await pixelAt(upright.pages[0].png, upright.pages[0].view, 72, 50, 700)).toEqual(WHITE);
    // Turned a quarter clockwise: what's shown at the top-left is the page's bottom-left.
    const turned = await nodeRender({ ...job, bytes: await onePage(90) });
    expect(await pixelAt(turned.pages[0].png, turned.pages[0].view, 72, 20, 80)).toEqual(BLACK);
    expect(await pixelAt(turned.pages[0].png, turned.pages[0].view, 72, 80, 20)).toEqual(WHITE);
    expect(await pixelAt(turned.pages[0].png, turned.pages[0].view, 72, 50, 770)).toEqual(WHITE);
  });

  it('whole pages are blacked out entirely; each search match is a mark', async () => {
    const bytes = bytesOf(path.join(FIXTURES, 'redaction.pdf'));
    const result = await nodeRender({ bytes, dpi: 72, wholePages: [0, 0], areas: [], find: [TERM, 'zzz'] });
    expect(result.matches).toEqual({ [TERM]: 4, zzz: 0 });
    expect(result.marks).toBe(5);
    expect(Object.keys(result.pages)).toEqual(['0', '1', '2']);
    expect(await pixelAt(result.pages[0].png, result.pages[0].view, 72, 306, 396)).toEqual(BLACK);
  });
});
