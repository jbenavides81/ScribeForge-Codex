// Redaction helpers for the build (Phase 0 plan, section 9). A redacted file keeps only pages:
// marked pages become images with their marks blacked out, and unmarked pages are copied with
// nothing hidden alongside them.
import {
  decodePDFRawStream,
  degrees,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFRawStream,
  PDFRef,
  PDFStream,
  PDFString,
  type PDFObject,
  type PDFPage,
} from '@cantoo/pdf-lib';
import { N, nameOf, resolve } from './objects';
import type { RedactedPage, Rotation } from './types';

/** A new page showing the image of a redacted page, the same size and turned the same way. */
export async function imagePage(out: PDFDocument, redacted: RedactedPage, rotation: Rotation): Promise<PDFPage> {
  const [x0, y0, x1, y1] = redacted.view;
  const width = Math.abs(x1 - x0);
  const height = Math.abs(y1 - y0);
  const left = Math.min(x0, x1);
  const bottom = Math.min(y0, y1);
  const page = out.addPage([width, height]);
  page.setMediaBox(left, bottom, width, height);
  const image = await out.embedPng(redacted.png);
  page.drawImage(image, { x: left, y: bottom, width, height });
  page.setRotation(degrees(rotation));
  return page;
}

/** All of a page's content streams, decoded and joined, as text. */
function pageContent(doc: PDFDocument, page: PDFDict): string {
  const contents = resolve(doc, page.get(N('Contents')));
  const streams = contents instanceof PDFArray ? Array.from({ length: contents.size() }, (_, i) => resolve(doc, contents.get(i))) : [contents];
  let text = '';
  for (const stream of streams) {
    try {
      if (stream instanceof PDFRawStream) text += new TextDecoder('latin1').decode(decodePDFRawStream(stream).decode()) + '\n';
      else if (stream instanceof PDFStream) text += new TextDecoder('latin1').decode(stream.getContents()) + '\n';
    } catch {
      return ''; // content that can't be read: keep everything rather than guess
    }
  }
  return text;
}

const unescapeName = (name: string) => name.replace(/#([0-9a-fA-F]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));

/**
 * Leaves out of a copied page's resources any picture or drawing (XObject) its content never
 * draws. Some files share one list of resources between all pages, so without this an image or
 * text block used only on a marked page could ride along, unseen, with an unmarked one.
 */
export function pruneUnusedXObjects(out: PDFDocument, page: PDFPage): number {
  const node = page.node;
  const resources = resolve(out, node.get(N('Resources')));
  if (!(resources instanceof PDFDict)) return 0;
  const xobjects = resolve(out, resources.get(N('XObject')));
  if (!(xobjects instanceof PDFDict)) return 0;
  const content = pageContent(out, node);
  if (content === '') return 0;
  const drawn = new Set<string>();
  for (const m of content.matchAll(/\/([^\s/<>[\]()%{}]+)\s+Do\b/g)) drawn.add(unescapeName(m[1]));
  const kept = out.context.obj({}) as PDFDict;
  let removed = 0;
  for (const [key, value] of xobjects.entries()) {
    if (drawn.has(key.decodeText())) kept.set(key, value);
    else removed++;
  }
  if (removed === 0) return 0;
  const copy = resources.clone(out.context);
  copy.set(N('XObject'), kept);
  node.set(N('Resources'), copy);
  return removed;
}

/** The layers (by reference) that the given pages' content can use. */
export function layersUsed(doc: PDFDocument, pages: PDFDict[]): Set<string> {
  const used = new Set<string>();
  const seen = new Set<PDFDict>();
  const addGroup = (obj: PDFObject | undefined) => {
    const value = resolve(doc, obj);
    if (!(value instanceof PDFDict)) return;
    const type = nameOf(value.get(N('Type')));
    if (type === 'OCG' && obj instanceof PDFRef) used.add(String(obj));
    if (type === 'OCMD') {
      const groups = value.get(N('OCGs'));
      const list = resolve(doc, groups);
      if (list instanceof PDFArray) for (let i = 0; i < list.size(); i++) addGroup(list.get(i));
      else addGroup(groups);
    }
  };
  const walk = (resources: PDFObject | undefined, depth: number) => {
    const dict = resolve(doc, resources);
    if (!(dict instanceof PDFDict) || seen.has(dict) || depth > 20) return;
    seen.add(dict);
    const properties = resolve(doc, dict.get(N('Properties')));
    if (properties instanceof PDFDict) for (const [, value] of properties.entries()) addGroup(value);
    const xobjects = resolve(doc, dict.get(N('XObject')));
    if (xobjects instanceof PDFDict) {
      for (const [, value] of xobjects.entries()) {
        const x = resolve(doc, value);
        if (!(x instanceof PDFStream || x instanceof PDFRawStream)) continue;
        addGroup(x.dict.get(N('OC')));
        walk(x.dict.get(N('Resources')), depth + 1);
      }
    }
  };
  for (const page of pages) walk(page.get(N('Resources')), 0);
  return used;
}

const normalise = (s: string) => s.normalize('NFKC').toLowerCase().replace(/\s+/g, '');

const ESCAPES: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' };

/**
 * The text strings in a page's drawing instructions, in order, joined: where a page's text is.
 * (Kerned text is drawn in pieces, so joining them finds a word split across pieces.)
 */
export function contentStrings(content: string): string {
  let out = '';
  for (let i = 0; i < content.length; i++) {
    const c = content[i];
    if (c === '%') {
      while (i < content.length && content[i] !== '\n' && content[i] !== '\r') i++;
    } else if (c === '(') {
      let depth = 1;
      for (i++; i < content.length && depth > 0; i++) {
        const ch = content[i];
        if (ch === '\\') {
          const next = content[++i];
          if (next === undefined) break;
          if (/[0-7]/.test(next)) {
            let octal = next;
            while (octal.length < 3 && /[0-7]/.test(content[i + 1] ?? '')) octal += content[++i];
            out += String.fromCharCode(parseInt(octal, 8) & 0xff);
          } else if (next === '\r' || next === '\n') {
            if (next === '\r' && content[i + 1] === '\n') i++;
          } else out += ESCAPES[next] ?? next;
        } else if (ch === '(') {
          depth++;
          out += ch;
        } else if (ch === ')') {
          depth--;
          if (depth > 0) out += ch;
        } else out += ch;
      }
      i--;
    } else if (c === '<' && content[i + 1] !== '<') {
      const end = content.indexOf('>', i);
      if (end < 0) break;
      const hex = content.slice(i + 1, end).replace(/[^0-9a-fA-F]/g, '');
      // A missing last digit counts as 0 (PDF's rule).
      for (let k = 0; k < hex.length; k += 2) out += String.fromCharCode(parseInt(hex[k] + (hex[k + 1] ?? '0'), 16));
      i = end;
    } else if (c === '<') {
      i++; // the start of a dictionary
    }
  }
  return out;
}

/**
 * The terms (of 3 or more letters) still found anywhere in a file: in any string, or in any
 * stream except pictures and font programs. Names are skipped: they're the file's own workings
 * (such as a font called Helvetica), never text from the document. A last check after redacting.
 */
export async function termsFound(bytes: Uint8Array, terms: string[]): Promise<string[]> {
  const wanted = terms.map((term) => ({ term, needle: normalise(term) })).filter((t) => t.needle.length >= 3);
  if (wanted.length === 0) return [];
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const found = new Set<string>();
  const check = (text: string) => {
    const n = normalise(text);
    for (const w of wanted) if (n.includes(w.needle)) found.add(w.term);
  };

  // Font programs are binary and hold no text; they're skipped.
  const fontFiles = new Set<string>();
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFDict && nameOf(obj.get(N('Type'))) === 'FontDescriptor') {
      for (const key of ['FontFile', 'FontFile2', 'FontFile3']) {
        const ref = obj.get(N(key));
        if (ref instanceof PDFRef) fontFiles.add(String(ref));
      }
    }
  }

  const visit = (o: PDFObject | undefined, depth: number): void => {
    if (o === undefined || depth > 50) return;
    if (o instanceof PDFString || o instanceof PDFHexString) check(o.decodeText());
    else if (o instanceof PDFArray) for (let i = 0; i < o.size(); i++) visit(o.get(i), depth + 1);
    else if (o instanceof PDFDict) {
      for (const [, v] of o.entries()) visit(v, depth + 1);
    }
  };
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFRawStream || obj instanceof PDFStream) {
      visit(obj.dict, 0);
      const type = nameOf(obj.dict.get(N('Type')));
      const subtype = nameOf(obj.dict.get(N('Subtype')));
      // Skipped: font programs and pictures (no text), and the containers that pack other
      // objects together or index them (each object in them is checked on its own).
      if (fontFiles.has(String(ref)) || subtype === 'Image' || type === 'ObjStm' || type === 'XRef') continue;
      let text: string;
      try {
        text = new TextDecoder('latin1').decode(obj instanceof PDFRawStream ? decodePDFRawStream(obj).decode() : obj.getContents());
      } catch {
        text = new TextDecoder('latin1').decode(obj instanceof PDFRawStream ? obj.getContents() : new Uint8Array());
      }
      // Drawing instructions (a page's or a form's): only their text strings are text.
      const drawing = (type === undefined && subtype === undefined) || subtype === 'Form';
      check(drawing ? contentStrings(text) : text);
    } else visit(obj, 0);
  }
  return wanted.filter((w) => found.has(w.term)).map((w) => w.term);
}
