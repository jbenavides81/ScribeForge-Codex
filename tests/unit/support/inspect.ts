// Test helpers that look inside a saved PDF: where a piece of text appears, what each page says,
// where links and bookmarks point, and whether any page exists outside the page list.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  decodePDFRawStream,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRawStream,
  PDFRef,
  PDFString,
  type PDFObject,
} from '@cantoo/pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

export const ROOT = path.resolve(import.meta.dirname, '../../..');
export const FIXTURES = path.join(ROOT, 'tests/fixtures/out');
const FONTS = `${path.join(ROOT, 'node_modules/pdfjs-dist/standard_fonts').replace(/\\/g, '/')}/`;

export const fixture = (name: string) => new Uint8Array(readFileSync(path.join(FIXTURES, name)));

function utf16be(s: string): Buffer {
  const b = Buffer.alloc(s.length * 2);
  for (let i = 0; i < s.length; i++) b.writeUInt16BE(s.charCodeAt(i), i * 2);
  return b;
}

/**
 * Every place `needle` appears in the file: raw bytes, every string and name, and every stream
 * after decompression, in plain, UTF-16 and hex forms. Empty means it's nowhere.
 */
export async function findEverywhere(bytes: Uint8Array, needle: string): Promise<string[]> {
  const plain = Buffer.from(needle, 'latin1');
  const forms = [plain, utf16be(needle), Buffer.from(plain.toString('hex').toUpperCase()), Buffer.from(plain.toString('hex'))];
  const has = (b: Buffer) => forms.some((f) => b.includes(f));
  const hits: string[] = [];
  if (has(Buffer.from(bytes))) hits.push('raw bytes');
  const doc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true });
  const walk = (o: PDFObject, where: string) => {
    if ((o instanceof PDFString || o instanceof PDFHexString || o instanceof PDFName) && o.decodeText().includes(needle)) hits.push(where);
    else if (o instanceof PDFArray) for (let i = 0; i < o.size(); i++) walk(o.get(i), where);
    else if (o instanceof PDFDict) for (const [k, v] of o.entries()) walk(v, `${where}/${k.decodeText()}`);
  };
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    const where = `object ${ref.objectNumber}`;
    if (obj instanceof PDFRawStream) {
      walk(obj.dict, where);
      let data: Buffer;
      try {
        data = Buffer.from(decodePDFRawStream(obj).decode());
      } catch {
        data = Buffer.from(obj.getContents());
      }
      if (has(data)) hits.push(`stream ${where}`);
    } else walk(obj, where);
  }
  return [...new Set(hits)];
}

/** The text of each page, as pdf.js reads it. */
export async function pageTexts(bytes: Uint8Array, password?: string): Promise<string[]> {
  const doc = await pdfjs.getDocument({ data: bytes.slice(), password, standardFontDataUrl: FONTS, useWorkerFetch: false }).promise;
  const out: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    out.push(content.items.map((t) => ('str' in t ? t.str : '')).join(' ').trim());
  }
  await doc.loadingTask.destroy();
  return out;
}

/** Every annotation other readers would show (not links, form fields or pop-ups), as pdf.js reads it. */
export async function annotations(bytes: Uint8Array) {
  const doc = await pdfjs.getDocument({ data: bytes.slice(), standardFontDataUrl: FONTS, useWorkerFetch: false, verbosity: 0 }).promise;
  const out: { page: number; subtype: string; contents: string; author: string; colour: number[]; quads: number; quadPoints: number[]; rect: number[] }[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    for (const a of await (await doc.getPage(i)).getAnnotations()) {
      if (a.subtype === 'Link' || a.subtype === 'Widget' || a.subtype === 'Popup') continue;
      out.push({
        page: i,
        subtype: a.subtype,
        contents: a.contentsObj?.str ?? '',
        author: a.titleObj?.str ?? '',
        colour: a.color ? [...a.color] : [],
        quads: a.quadPoints ? a.quadPoints.length / 8 : 0,
        quadPoints: a.quadPoints ? [...a.quadPoints] : [],
        rect: a.rect,
      });
    }
  }
  await doc.loadingTask.destroy();
  return out;
}

/** "UNIQUE-PAGE-3" → 3, for each page (0 for a page without one). */
export async function pageIds(bytes: Uint8Array): Promise<string[]> {
  return (await pageTexts(bytes)).map((t) => /(UNIQUE-PAGE-\d|SECOND-DOC-PAGE-\d)/.exec(t)?.[1] ?? 'blank');
}

export interface LinkInfo {
  page: number;
  kind: 'page' | 'web' | 'other';
  /** For page links: 1-based target page, or 0 if it points outside the page list. */
  target?: number;
  uri?: string;
}

export async function links(bytes: Uint8Array): Promise<LinkInfo[]> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const pages = doc.getPages();
  const index = new Map(pages.map((p, i) => [p.ref.toString(), i + 1]));
  const out: LinkInfo[] = [];
  pages.forEach((page, i) => {
    const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    for (let k = 0; k < (annots?.size() ?? 0); k++) {
      const a = annots!.lookup(k) as PDFDict;
      if (a.get(PDFName.of('Subtype'))?.toString() !== '/Link') continue;
      const dest = a.lookupMaybe(PDFName.of('Dest'), PDFArray);
      const action = a.lookupMaybe(PDFName.of('A'), PDFDict);
      if (dest) {
        const first = dest.get(0);
        out.push({ page: i + 1, kind: 'page', target: first instanceof PDFRef ? (index.get(first.toString()) ?? 0) : 0 });
      } else if (action?.get(PDFName.of('S'))?.toString() === '/URI') {
        out.push({ page: i + 1, kind: 'web', uri: (action.lookup(PDFName.of('URI')) as PDFString).decodeText() });
      } else out.push({ page: i + 1, kind: 'other' });
    }
  });
  return out;
}

export interface BookmarkInfo {
  title: string;
  /** 1-based page, 0 if outside the page list, undefined for a heading. */
  page?: number;
  children: BookmarkInfo[];
}

export async function bookmarks(bytes: Uint8Array): Promise<BookmarkInfo[]> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const index = new Map(doc.getPages().map((p, i) => [p.ref.toString(), i + 1]));
  const root = doc.catalog.lookupMaybe(PDFName.of('Outlines'), PDFDict);
  const level = (first: PDFObject | undefined): BookmarkInfo[] => {
    const items: BookmarkInfo[] = [];
    let item = first instanceof PDFRef ? doc.context.lookup(first) : first;
    while (item instanceof PDFDict) {
      const dest = item.lookupMaybe(PDFName.of('Dest'), PDFArray);
      const ref = dest?.get(0);
      items.push({
        title: (item.lookup(PDFName.of('Title')) as PDFString | PDFHexString).decodeText(),
        page: dest ? (ref instanceof PDFRef ? (index.get(ref.toString()) ?? 0) : 0) : undefined,
        children: level(item.get(PDFName.of('First'))),
      });
      const next = item.get(PDFName.of('Next'));
      item = next instanceof PDFRef ? doc.context.lookup(next) : undefined;
    }
    return items;
  };
  return root ? level(root.get(PDFName.of('First'))) : [];
}

/** Page objects anywhere in the file that are not in the page list. Must always be 0. */
export async function strayPages(bytes: Uint8Array): Promise<number> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const inTree = new Set(doc.getPages().map((p) => p.ref.toString()));
  let stray = 0;
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFDict && obj.get(PDFName.of('Type'))?.toString() === '/Page' && !inTree.has(ref.toString())) stray++;
  }
  return stray;
}

export async function rotations(bytes: Uint8Array): Promise<number[]> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  return doc.getPages().map((p) => p.getRotation().angle);
}

export async function sizes(bytes: Uint8Array): Promise<[number, number][]> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  return doc.getPages().map((p) => [Math.round(p.getWidth()), Math.round(p.getHeight())]);
}

/** Where a piece of text sits on a page, in the page's own (unturned) coordinates. */
export async function textPosition(bytes: Uint8Array, page: number, needle: string): Promise<{ x: number; y: number; width: number; height: number } | null> {
  const doc = await pdfjs.getDocument({ data: bytes.slice(), standardFontDataUrl: FONTS, useWorkerFetch: false }).promise;
  const content = await (await doc.getPage(page)).getTextContent();
  const item = content.items.find((t) => 'str' in t && t.str.includes(needle));
  await doc.loadingTask.destroy();
  if (!item || !('transform' in item)) return null;
  return { x: item.transform[4], y: item.transform[5], width: item.width, height: item.height };
}

/**
 * The text pdf.js actually draws on a page, leaving out anything in a hidden layer (which
 * getTextContent would still include).
 */
export async function drawnText(bytes: Uint8Array, page: number): Promise<string> {
  const doc = await pdfjs.getDocument({ data: bytes.slice(), standardFontDataUrl: FONTS, useWorkerFetch: false, verbosity: 0 }).promise;
  const config = await doc.getOptionalContentConfig();
  const ops = await (await doc.getPage(page)).getOperatorList();
  const OPS = pdfjs.OPS;
  let hidden = 0;
  let text = '';
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    const args = ops.argsArray[i];
    if (fn === OPS.beginMarkedContentProps) {
      if (hidden > 0 || (args[0] === 'OC' && args[1] && !config.isVisible(args[1]))) hidden++;
    } else if (fn === OPS.beginMarkedContent) {
      if (hidden > 0) hidden++;
    } else if (fn === OPS.endMarkedContent) {
      if (hidden > 0) hidden--;
    } else if (fn === OPS.showText && hidden === 0) {
      text += (args[0] as { unicode?: string }[]).map((g) => g?.unicode ?? '').join('') + ' ';
    }
  }
  await doc.loadingTask.destroy();
  return text.trim();
}

/** The document's details as pdf.js reads them: the classic ones and the XMP copy. */
export async function readerDetails(bytes: Uint8Array): Promise<{ info: Record<string, unknown>; xmp: Record<string, unknown> | null }> {
  const doc = await pdfjs.getDocument({ data: bytes.slice(), standardFontDataUrl: FONTS, useWorkerFetch: false, verbosity: 0 }).promise;
  const { info, metadata } = await doc.getMetadata();
  await doc.loadingTask.destroy();
  return { info: info as Record<string, unknown>, xmp: metadata ? Object.fromEntries(metadata) : null };
}
