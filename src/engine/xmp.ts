// XMP: the second copy of a PDF's details (title, author, …), kept as XML in the file. Readers
// such as Acrobat and Windows prefer it to the classic details, so the two must agree.
//
// The engine runs where there's no XML parser (a worker, and Node for the tests), so this reads
// only the handful of properties ScribeForge shows, in the two ways XMP writes a simple value:
// as an element (<dc:title>…</dc:title>) or as an attribute (pdf:Producer="…"). Anything that
// doesn't look like XMP is reported as unreadable. New files always get a fresh copy written by
// writeXmp, so nothing old or unreadable is ever carried over.

const NS = {
  rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  dc: 'http://purl.org/dc/elements/1.1/',
  pdf: 'http://ns.adobe.com/pdf/1.3/',
  xmp: 'http://ns.adobe.com/xap/1.0/',
};

export interface XmpValues {
  title?: string;
  /** dc:creator, the author or authors, joined with "; ". */
  author?: string;
  /** dc:description, which is the classic details' "subject". */
  subject?: string;
  /** pdf:Keywords, or else the dc:subject list joined with ", ". */
  keywords?: string;
  producer?: string;
  creatorTool?: string;
  createDate?: string;
  modifyDate?: string;
}

export type XmpRead = { state: 'none' } | { state: 'unreadable' } | { state: 'read'; values: XmpValues };

/** Turns the stream's bytes into text: UTF-8, or UTF-16 when it starts with a byte order mark. */
export function decodeXmpBytes(bytes: Uint8Array): string {
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  return new TextDecoder('utf-8').decode(bytes);
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function decodeEntities(text: string): string {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, inner: string) => inner.replace(/&/g, '&amp;').replace(/</g, '&lt;'))
    .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (whole, code: string) => {
      const lower = code.toLowerCase();
      if (lower === 'amp') return '&';
      if (lower === 'lt') return '<';
      if (lower === 'gt') return '>';
      if (lower === 'quot') return '"';
      if (lower === 'apos') return "'";
      const n = lower.startsWith('#x') ? parseInt(lower.slice(2), 16) : parseInt(lower.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
    });
}

/** The prefixes a namespace is bound to in this packet (usually just one, such as "dc"). */
function prefixesFor(text: string, uri: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(/xmlns:([A-Za-z_][\w.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g)) {
    if ((m[3] ?? m[4]) === uri) found.add(m[1]);
  }
  return [...found];
}

/** Every value of one property: the list items if it's a list, otherwise its text. */
function readProperty(text: string, prefixes: string[], name: string, rdf: string[]): string[] | undefined {
  for (const prefix of prefixes) {
    const qname = `${escapeRegExp(prefix)}:${escapeRegExp(name)}`;
    // Element form.
    const element = new RegExp(`<${qname}(?:\\s[^>]*)?>([\\s\\S]*?)</${qname}\\s*>`).exec(text);
    if (element) {
      const inner = element[1];
      for (const r of rdf) {
        const li = escapeRegExp(r);
        const items = [...inner.matchAll(new RegExp(`<${li}:li(\\s[^>]*)?>([\\s\\S]*?)</${li}:li\\s*>`, 'g'))];
        if (items.length > 0) {
          // A list of languages (rdf:Alt) gives one value: the default language, or else the first.
          // Any other list (rdf:Seq, rdf:Bag) gives all of its items.
          const languages = items.some((m) => /xml:lang\s*=/.test(m[1] ?? ''));
          const preferred = items.find((m) => /xml:lang\s*=\s*["']x-default["']/.test(m[1] ?? '')) ?? items[0];
          return (languages ? [preferred] : items).map((m) => decodeEntities(m[2]).trim());
        }
      }
      if (/<[A-Za-z]/.test(inner.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, ''))) return []; // a structure it doesn't know
      return [decodeEntities(inner).trim()];
    }
    // Attribute form, on an rdf:Description.
    for (const r of rdf) {
      for (const d of text.matchAll(new RegExp(`<${escapeRegExp(r)}:Description\\b([^>]*)>`, 'g'))) {
        const attr = new RegExp(`(?:^|\\s)${qname}\\s*=\\s*("([^"]*)"|'([^']*)')`).exec(d[1]);
        if (attr) return [decodeEntities(attr[2] ?? attr[3]).trim()];
      }
    }
  }
  return undefined;
}

/** Reads the details ScribeForge shows from an XMP packet. */
export function readXmp(text: string): XmpRead {
  const rdf = prefixesFor(text, NS.rdf);
  if (rdf.length === 0 || !rdf.some((r) => new RegExp(`<${escapeRegExp(r)}:RDF\\b[\\s\\S]*</${escapeRegExp(r)}:RDF\\s*>`).test(text))) {
    return { state: 'unreadable' };
  }
  const dc = prefixesFor(text, NS.dc);
  const pdf = prefixesFor(text, NS.pdf);
  const xmp = prefixesFor(text, NS.xmp);
  const one = (prefixes: string[], name: string, join: string) => {
    const values = readProperty(text, prefixes, name, rdf)?.filter((v) => v !== '');
    return values && values.length > 0 ? values.join(join) : undefined;
  };
  const values: XmpValues = {
    title: one(dc, 'title', ' '),
    author: one(dc, 'creator', '; '),
    subject: one(dc, 'description', ' '),
    keywords: one(pdf, 'Keywords', ', ') ?? one(dc, 'subject', ', '),
    producer: one(pdf, 'Producer', ' '),
    creatorTool: one(xmp, 'CreatorTool', ' '),
    createDate: one(xmp, 'CreateDate', ' '),
    modifyDate: one(xmp, 'ModifyDate', ' '),
  };
  for (const key of Object.keys(values) as (keyof XmpValues)[]) if (values[key] === undefined) delete values[key];
  return { state: 'read', values };
}

/** Text safe inside an XML element: escaped, and without characters XML can't hold. */
function xmlText(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** A date as XMP writes it: 2026-10-19T10:30:00-05:00, in this computer's time zone. */
export function xmpDate(date: Date): string {
  const pad = (n: number) => String(Math.trunc(Math.abs(n))).padStart(2, '0');
  const offset = -date.getTimezoneOffset();
  const zone = offset === 0 ? 'Z' : `${offset > 0 ? '+' : '-'}${pad(offset / 60)}:${pad(offset % 60)}`;
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${zone}`
  );
}

/** Splits keywords typed as "one, two; three" into a list. */
export function splitKeywords(keywords: string): string[] {
  return keywords
    .split(/[,;]/)
    .map((k) => k.trim())
    .filter((k) => k !== '');
}

export interface XmpWrite {
  title: string;
  author: string;
  subject: string;
  keywords: string;
  producer: string;
  creatorTool: string;
  created?: Date;
  modified: Date;
}

/** A complete XMP packet holding the same details as the classic ones. */
export function writeXmp(v: XmpWrite): string {
  const lines: string[] = ['<dc:format>application/pdf</dc:format>'];
  const alt = (tag: string, value: string) =>
    `<${tag}><rdf:Alt><rdf:li xml:lang="x-default">${xmlText(value)}</rdf:li></rdf:Alt></${tag}>`;
  if (v.title) lines.push(alt('dc:title', v.title));
  if (v.author) lines.push(`<dc:creator><rdf:Seq><rdf:li>${xmlText(v.author)}</rdf:li></rdf:Seq></dc:creator>`);
  if (v.subject) lines.push(alt('dc:description', v.subject));
  if (v.keywords) {
    const items = splitKeywords(v.keywords).map((k) => `<rdf:li>${xmlText(k)}</rdf:li>`);
    if (items.length > 0) lines.push(`<dc:subject><rdf:Bag>${items.join('')}</rdf:Bag></dc:subject>`);
    lines.push(`<pdf:Keywords>${xmlText(v.keywords)}</pdf:Keywords>`);
  }
  if (v.producer) lines.push(`<pdf:Producer>${xmlText(v.producer)}</pdf:Producer>`);
  if (v.creatorTool) lines.push(`<xmp:CreatorTool>${xmlText(v.creatorTool)}</xmp:CreatorTool>`);
  if (v.created) lines.push(`<xmp:CreateDate>${xmpDate(v.created)}</xmp:CreateDate>`);
  lines.push(`<xmp:ModifyDate>${xmpDate(v.modified)}</xmp:ModifyDate>`);
  lines.push(`<xmp:MetadataDate>${xmpDate(v.modified)}</xmp:MetadataDate>`);
  return [
    '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>',
    '<x:xmpmeta xmlns:x="adobe:ns:meta/">',
    ` <rdf:RDF xmlns:rdf="${NS.rdf}">`,
    `  <rdf:Description rdf:about="" xmlns:dc="${NS.dc}" xmlns:pdf="${NS.pdf}" xmlns:xmp="${NS.xmp}">`,
    ...lines.map((l) => `   ${l}`),
    '  </rdf:Description>',
    ' </rdf:RDF>',
    '</x:xmpmeta>',
    '<?xpacket end="w"?>',
  ].join('\n');
}
