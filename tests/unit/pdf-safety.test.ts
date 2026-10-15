import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFString } from '@cantoo/pdf-lib';
import { MAX_IMAGE_PIXELS, safeDocumentOptions } from '../../src/shared/pdfOptions';

const ROOT = path.resolve(import.meta.dirname, '../..');
const FIXTURES = path.join(ROOT, 'tests/fixtures/out');
const FONTS = `${path.join(ROOT, 'node_modules/pdfjs-dist/standard_fonts').replace(/\\/g, '/')}/`;

function open(name: string, password?: string) {
  const data = new Uint8Array(readFileSync(path.join(FIXTURES, name)));
  return pdfjs.getDocument({ data, password, standardFontDataUrl: FONTS, enableXfa: false, useWorkerFetch: false }).promise;
}

async function text(doc: pdfjs.PDFDocumentProxy): Promise<string> {
  const parts: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    parts.push((await (await doc.getPage(i)).getTextContent()).items.map((t) => ('str' in t ? t.str : '')).join(' '));
  }
  return parts.join('\n');
}

beforeAll(() => {
  execFileSync(process.execPath, ['scripts/make-fixtures.mjs'], { cwd: ROOT, stdio: 'ignore' });
}, 120_000);

describe('safe pdf.js settings', () => {
  it('turns off XFA and pdf.js fetching, and loads support files from the app', () => {
    const o = safeDocumentOptions(new Uint8Array([1]), 'app://scribeforge/pdfjs/');
    expect(o.enableXfa).toBe(false);
    expect(o.useWorkerFetch).toBe(false);
    expect(o.stopAtErrors).toBe(false);
    expect(o.maxImageSize).toBe(MAX_IMAGE_PIXELS);
    for (const url of [o.cMapUrl, o.standardFontDataUrl, o.wasmUrl, o.iccUrl]) expect(url.startsWith('app://scribeforge/pdfjs/')).toBe(true);
    expect('url' in o).toBe(false);
  });

  it('refuses an asset address without a trailing slash', () => {
    expect(() => safeDocumentOptions(new Uint8Array(), 'app://scribeforge/pdfjs')).toThrow();
  });

  it('never ships pdf.js\'s scripting sandbox, and no screen code turns scripting on', () => {
    const src = path.join(ROOT, 'src');
    const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(path.join(d, f)).isDirectory() ? walk(path.join(d, f)) : [path.join(d, f)]));
    for (const file of walk(src)) {
      const code = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(code, file).not.toMatch(/enableScripting\s*:\s*true|PDFScriptingManager|pdf\.sandbox/);
    }
    const out = path.join(ROOT, 'out/renderer');
    if (existsSync(out)) {
      expect(walk(out).filter((f) => /sandbox/i.test(path.basename(f)))).toEqual([]);
    }
  });
});

describe('test PDFs', () => {
  it('normal.pdf has 3 pages, five "anvil"s and a line to copy', async () => {
    const doc = await open('normal.pdf');
    expect(doc.numPages).toBe(3);
    const t = await text(doc);
    expect(t.match(/anvil/g)?.length).toBe(5);
    expect(t).toContain('quill and anvil 0O1lI');
  });

  it('large.pdf has 600 pages', async () => {
    expect((await open('large.pdf')).numPages).toBe(600);
  });

  it('protected.pdf needs its password', async () => {
    await expect(open('protected.pdf')).rejects.toMatchObject({ name: 'PasswordException' });
    await expect(open('protected.pdf', 'wrong')).rejects.toMatchObject({ name: 'PasswordException' });
    const doc = await open('protected.pdf', 'open-sesame');
    expect(await text(doc)).toContain('Protected test document');
  });

  it('scripted.pdf really contains JavaScript in all four places (so the app test means something)', async () => {
    const doc = await PDFDocument.load(readFileSync(path.join(FIXTURES, 'scripted.pdf')));
    const js = (d: PDFDict | undefined) => (d?.lookup(PDFName.of('JS')) as PDFString | undefined)?.decodeText() ?? '';
    const page = doc.getPage(0).node;
    const onOpen = doc.catalog.lookup(PDFName.of('OpenAction'), PDFDict);
    const onPageOpen = page.lookup(PDFName.of('AA'), PDFDict).lookup(PDFName.of('O'), PDFDict);
    const link = page.lookup(PDFName.of('Annots'), PDFArray).lookup(0, PDFDict).lookup(PDFName.of('A'), PDFDict);
    const named = doc.catalog.lookup(PDFName.of('Names'), PDFDict).lookup(PDFName.of('JavaScript'), PDFDict).lookup(PDFName.of('Names'), PDFArray).lookup(1, PDFDict);
    for (const action of [onOpen, onPageOpen, link, named]) expect(js(action)).toContain("app.alert('SCRIPT RAN')");
  });

  it('not-a-pdf.pdf is refused as invalid', async () => {
    await expect(open('not-a-pdf.pdf')).rejects.toMatchObject({ name: 'InvalidPDFException' });
  });
});
