// Reads a PDF's details (title, author, …, in both places a PDF keeps them) and lists everything
// the file carries besides what's drawn on its pages: attachments, form fields, comments, scripts
// and other risky actions, bookmarks, layers (including hidden ones) and links. Used for the
// Details screen and, on the new file, before every save.
import { decodePDFRawStream, PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFStream, type PDFObject } from '@cantoo/pdf-lib';
import { N, nameOf, nameTreeEntries, openSource, resolve, textOf } from './objects';
import { readOutline, type OutlineNode } from './outline';
import {
  DOC_INFO_FIELDS,
  type ActionPlace,
  type Carries,
  type Disagreement,
  type DocInfo,
  type FileDetails,
  type FileReport,
  type RiskyAction,
  type SourceInput,
} from './types';
import { decodeXmpBytes, readXmp, splitKeywords, type XmpRead } from './xmp';

const STANDARD_INFO = new Set(['Title', 'Author', 'Subject', 'Keywords', 'Creator', 'Producer', 'CreationDate', 'ModDate', 'Trapped']);
/** Annotation kinds that aren't comments: links, form fields, pop-up windows and attached files. */
const NOT_COMMENTS = new Set(['Link', 'Widget', 'Popup', 'FileAttachment']);
const MAX_PAGES_WALKED = 20_000;

const attempt = <T>(read: () => T): T | undefined => {
  try {
    return read();
  } catch {
    return undefined;
  }
};

/** The classic details (Info dictionary), with empty strings for anything missing. */
export function readInfo(doc: PDFDocument): FileDetails['info'] & { created?: Date; modified?: Date } {
  return {
    title: attempt(() => doc.getTitle()) ?? '',
    author: attempt(() => doc.getAuthor()) ?? '',
    subject: attempt(() => doc.getSubject()) ?? '',
    keywords: attempt(() => doc.getKeywords()) ?? '',
    creator: attempt(() => doc.getCreator()) ?? '',
    producer: attempt(() => doc.getProducer()) ?? '',
    created: attempt(() => doc.getCreationDate()),
    modified: attempt(() => doc.getModificationDate()),
  };
}

/** The XMP copy of the details, if the file has one. */
export function readXmpFrom(doc: PDFDocument): XmpRead {
  const stream = resolve(doc, doc.catalog.get(N('Metadata')));
  if (stream === undefined) return { state: 'none' };
  const bytes = attempt(() => {
    if (stream instanceof PDFRawStream) return decodePDFRawStream(stream).decode();
    if (stream instanceof PDFStream) return stream.getContents();
    return undefined;
  });
  if (!bytes) return { state: 'unreadable' };
  return attempt(() => readXmp(decodeXmpBytes(bytes))) ?? { state: 'unreadable' };
}

const tidy = (s: string) => s.replace(/\s+/g, ' ').trim();
const asSet = (s: string) => new Set(splitKeywords(s).map((k) => tidy(k).toLowerCase()));

/** True when two values of a detail mean the same (lists such as authors are compared as sets). */
function same(field: keyof DocInfo, a: string, b: string): boolean {
  if (field === 'author' || field === 'keywords') {
    const x = asSet(a);
    const y = asSet(b);
    return x.size === y.size && [...x].every((v) => y.has(v));
  }
  return tidy(a) === tidy(b);
}

export function readDetails(doc: PDFDocument, bytes: Uint8Array): FileDetails {
  const info = readInfo(doc);
  const xmpRead = readXmpFrom(doc);
  const xmpValues = xmpRead.state === 'read' ? xmpRead.values : {};
  const disagreements: Disagreement[] = [];
  const shown = { title: '', author: '', subject: '', keywords: '' };
  for (const field of DOC_INFO_FIELDS) {
    const fromInfo = info[field];
    const fromXmp = xmpValues[field] ?? '';
    shown[field] = fromInfo || fromXmp;
    if (fromInfo && fromXmp && !same(field, fromInfo, fromXmp)) disagreements.push({ field, info: fromInfo, xmp: fromXmp });
  }

  // Version: the header, unless the catalog names a later one.
  const header = /%PDF-(\d+\.\d+)/.exec(new TextDecoder('latin1').decode(bytes.subarray(0, 1024)))?.[1] ?? '';
  const catalogVersion = nameOf(doc.catalog.get(N('Version'))) ?? '';
  const version = Number(catalogVersion) > Number(header) ? catalogVersion : header;

  const sizes = new Map<string, { width: number; height: number; count: number }>();
  const pages = doc.getPages();
  for (const page of pages) {
    const box = attempt(() => page.getCropBox()) ?? page.getSize();
    const turned = (((page.getRotation().angle % 360) + 360) % 360) % 180 === 90;
    const w = Math.round((turned ? box.height : box.width) * 10) / 10;
    const h = Math.round((turned ? box.width : box.height) * 10) / 10;
    const key = `${w}x${h}`;
    const entry = sizes.get(key) ?? { width: w, height: h, count: 0 };
    entry.count++;
    sizes.set(key, entry);
  }

  return {
    info: { title: info.title, author: info.author, subject: info.subject, keywords: info.keywords, creator: info.creator, producer: info.producer },
    created: info.created?.toISOString(),
    modified: info.modified?.toISOString(),
    xmp: xmpRead.state === 'read' ? { state: 'read', values: xmpValues } : xmpRead,
    disagreements,
    shown,
    version,
    pageCount: pages.length,
    pageSizes: [...sizes.values()].sort((a, b) => b.count - a.count),
    encrypted: doc.context.isDecrypted === true,
  };
}

/** The kind of a risky action, or undefined for harmless ones (links, page commands, …). */
function riskOf(action: PDFDict): RiskyAction | undefined {
  switch (nameOf(action.get(N('S')))) {
    case 'JavaScript':
    case 'RichMediaExecute':
      return 'script';
    case 'Rendition':
      return action.has(N('JS')) ? 'script' : undefined;
    case 'Launch':
      return 'launch';
    case 'SubmitForm':
      return 'submit';
    case 'ImportData':
      return 'import';
    case 'GoToR':
    case 'GoToE':
      return 'other-file';
    default:
      return undefined;
  }
}

/** Finds risky actions; each action is counted once, wherever it's reached from. */
class ActionFinder {
  readonly found: (ActionPlace & { action: RiskyAction })[] = [];
  private seen = new Set<PDFDict>();

  constructor(private doc: PDFDocument) {}

  /** An action and the actions chained after it (/Next). */
  add(obj: PDFObject | undefined, place: ActionPlace, depth = 0): void {
    const action = resolve(this.doc, obj);
    if (depth > 20) return;
    if (action instanceof PDFArray) {
      for (let i = 0; i < action.size(); i++) this.add(action.get(i), place, depth + 1);
      return;
    }
    if (!(action instanceof PDFDict) || this.seen.has(action)) return;
    this.seen.add(action);
    const risk = riskOf(action);
    if (risk) this.found.push({ ...place, action: risk });
    this.add(action.get(N('Next')), place, depth + 1);
  }

  /** Every action in an "additional actions" (/AA) dictionary. */
  addAll(aa: PDFObject | undefined, place: (event: string) => ActionPlace): void {
    const dict = resolve(this.doc, aa);
    if (!(dict instanceof PDFDict)) return;
    for (const [key, value] of dict.entries()) this.add(value, place(key.decodeText()));
  }
}

/** Risky actions that belong to the whole document rather than a page. */
export function documentActions(doc: PDFDocument): (ActionPlace & { action: RiskyAction })[] {
  const finder = new ActionFinder(doc);
  findDocumentActions(doc, finder);
  return finder.found;
}

function findDocumentActions(doc: PDFDocument, finder: ActionFinder): void {
  const openAction = resolve(doc, doc.catalog.get(N('OpenAction')));
  if (openAction instanceof PDFDict) finder.add(openAction, { where: 'open' });
  finder.addAll(doc.catalog.get(N('AA')), (event) => ({ where: 'document-event', event }));
  const names = doc.catalog.lookupMaybe(N('Names'), PDFDict);
  for (const [name, action] of nameTreeEntries(doc, names?.lookupMaybe(N('JavaScript'), PDFDict))) {
    finder.add(action, { where: 'document', name });
  }
  // Bookmarks can run actions too.
  const outlines = doc.catalog.lookupMaybe(N('Outlines'), PDFDict);
  const seen = new Set<PDFDict>();
  const walk = (first: PDFObject | undefined, depth: number) => {
    let item = resolve(doc, first);
    while (item instanceof PDFDict && !seen.has(item) && seen.size < 10_000 && depth < 50) {
      seen.add(item);
      finder.add(item.get(N('A')), { where: 'bookmark', title: textOf(resolve(doc, item.get(N('Title')))) ?? '' });
      walk(item.get(N('First')), depth + 1);
      item = resolve(doc, item.get(N('Next')));
    }
  };
  walk(outlines?.get(N('First')), 0);
}

/** A form field's full name, following its parents (such as "address.city"). */
function fieldName(doc: PDFDocument, field: PDFDict): string {
  const parts: string[] = [];
  let node: PDFObject | undefined = field;
  for (let depth = 0; node instanceof PDFDict && depth < 30; depth++) {
    const t = textOf(resolve(doc, node.get(N('T'))));
    if (t) parts.unshift(t);
    node = resolve(doc, node.get(N('Parent')));
  }
  return parts.join('.');
}

function hasValue(v: PDFObject | undefined): boolean {
  if (v === undefined) return false;
  if (v instanceof PDFName) return v.decodeText() !== 'Off';
  if (v instanceof PDFArray) return v.size() > 0;
  const text = textOf(v);
  return text === undefined ? true : text !== '';
}

function countOutline(nodes: OutlineNode[]): number {
  return nodes.reduce((n, node) => n + 1 + countOutline(node.children), 0);
}

function filespecName(doc: PDFDocument, spec: PDFObject | undefined, fallback: string): { name: string; size?: number } {
  const fs = resolve(doc, spec);
  if (!(fs instanceof PDFDict)) return { name: textOf(fs) ?? fallback };
  const name = textOf(resolve(doc, fs.get(N('UF')))) ?? textOf(resolve(doc, fs.get(N('F')))) ?? fallback;
  const ef = fs.lookupMaybe(N('EF'), PDFDict);
  const stream = resolve(doc, ef?.get(N('F')) ?? ef?.get(N('UF')));
  let size: number | undefined;
  if (stream instanceof PDFStream || stream instanceof PDFRawStream) {
    const params = resolve(doc, stream.dict.get(N('Params')));
    const declared = params instanceof PDFDict ? resolve(doc, params.get(N('Size'))) : undefined;
    size = declared instanceof PDFNumber ? declared.asNumber() : undefined;
  }
  return { name, size };
}

export function readCarries(doc: PDFDocument, details: FileDetails): Carries {
  const finder = new ActionFinder(doc);
  findDocumentActions(doc, finder);

  // Details, in a fixed order, then anything non-standard.
  const infoDict = resolve(doc, doc.context.trailerInfo.Info);
  const detailList: { key: string; value: string }[] = [];
  const add = (key: string, value: string | undefined) => {
    if (value) detailList.push({ key, value });
  };
  add('Title', details.info.title);
  add('Author', details.info.author);
  add('Subject', details.info.subject);
  add('Keywords', details.info.keywords);
  add('Creator', details.info.creator);
  add('Producer', details.info.producer);
  add('CreationDate', details.created);
  add('ModDate', details.modified);
  if (infoDict instanceof PDFDict) {
    for (const [key, value] of infoDict.entries()) {
      const k = key.decodeText();
      if (STANDARD_INFO.has(k)) continue;
      const v = resolve(doc, value);
      add(k, textOf(v) ?? nameOf(v) ?? v?.toString());
    }
  }

  // Document attachments.
  const names = doc.catalog.lookupMaybe(N('Names'), PDFDict);
  const attachments: Carries['attachments'] = nameTreeEntries(doc, names?.lookupMaybe(N('EmbeddedFiles'), PDFDict)).map(([key, spec]) =>
    filespecName(doc, spec, key || 'attachment'),
  );

  // Form fields.
  const formFields: Carries['formFields'] = [];
  const acroForm = doc.catalog.lookupMaybe(N('AcroForm'), PDFDict);
  const seenFields = new Set<PDFDict>();
  const walkFields = (list: PDFObject | undefined, inherited: PDFObject | undefined, depth: number) => {
    const arr = resolve(doc, list);
    if (!(arr instanceof PDFArray) || depth > 30) return;
    for (let i = 0; i < arr.size() && formFields.length < 10_000; i++) {
      const field = resolve(doc, arr.get(i));
      if (!(field instanceof PDFDict) || seenFields.has(field)) continue;
      seenFields.add(field);
      const value = field.get(N('V')) ?? inherited;
      finder.addAll(field.get(N('AA')), () => ({ where: 'field', name: fieldName(doc, field) }));
      finder.add(field.get(N('A')), { where: 'field', name: fieldName(doc, field) });
      const kids = field.lookupMaybe(N('Kids'), PDFArray);
      const kidFields = kids ? Array.from({ length: kids.size() }, (_, k) => resolve(doc, kids.get(k))).filter((k) => k instanceof PDFDict && k.has(N('T'))) : [];
      if (kidFields.length > 0) walkFields(kids, value, depth + 1);
      else formFields.push({ name: fieldName(doc, field), filled: hasValue(resolve(doc, value)) });
    }
  };
  walkFields(acroForm?.get(N('Fields')), undefined, 0);

  // Pages: comments, links, attachments on pages, and page and annotation actions.
  const comments: Carries['comments'] = { total: 0, kinds: {}, authors: [] };
  const authors = new Set<string>();
  const web = new Set<string>();
  const links = { webLinks: 0, pages: 0, otherFiles: 0 };
  const pages = doc.getPages();
  for (let p = 0; p < pages.length && p < MAX_PAGES_WALKED; p++) {
    const page = p + 1;
    const node = pages[p].node;
    finder.addAll(node.get(N('AA')), (event) => ({ where: 'page', page, event: event === 'C' ? 'close' : 'open' }));
    const annots = node.lookupMaybe(N('Annots'), PDFArray);
    for (let k = 0; k < (annots?.size() ?? 0); k++) {
      const annot = resolve(doc, annots?.get(k));
      if (!(annot instanceof PDFDict)) continue;
      const subtype = nameOf(annot.get(N('Subtype'))) ?? 'Unknown';
      if (subtype === 'Link') {
        const action = resolve(doc, annot.get(N('A')));
        const kind = action instanceof PDFDict ? nameOf(action.get(N('S'))) : undefined;
        if (kind === 'URI' && action instanceof PDFDict) {
          links.webLinks++;
          const uri = textOf(resolve(doc, action.get(N('URI'))));
          if (uri) web.add(uri);
        } else if (kind === 'GoToR' || kind === 'GoToE') links.otherFiles++;
        else if (annot.has(N('Dest')) || kind === 'GoTo' || kind === 'Named') links.pages++;
        finder.add(action, { where: 'link', page });
      } else if (subtype === 'Widget') {
        const name = fieldName(doc, annot);
        finder.add(annot.get(N('A')), { where: 'field', name, page });
        finder.addAll(annot.get(N('AA')), () => ({ where: 'field', name, page }));
      } else {
        finder.add(annot.get(N('A')), { where: 'annotation', page });
        finder.addAll(annot.get(N('AA')), () => ({ where: 'annotation', page }));
        if (subtype === 'FileAttachment') {
          attachments.push({ ...filespecName(doc, annot.get(N('FS')), 'attachment'), page });
        } else if (!NOT_COMMENTS.has(subtype)) {
          comments.total++;
          comments.kinds[subtype] = (comments.kinds[subtype] ?? 0) + 1;
          const author = textOf(resolve(doc, annot.get(N('T'))));
          if (author?.trim()) authors.add(author.trim());
        }
      }
    }
  }
  comments.authors = [...authors].sort((a, b) => a.localeCompare(b));

  // Layers, and which start hidden.
  const layers: Carries['layers'] = [];
  const oc = doc.catalog.lookupMaybe(N('OCProperties'), PDFDict);
  const groups = oc?.lookupMaybe(N('OCGs'), PDFArray);
  if (groups) {
    const config = oc?.lookupMaybe(N('D'), PDFDict);
    const listed = (key: string) => {
      const arr = config?.lookupMaybe(N(key), PDFArray);
      return new Set(Array.from({ length: arr?.size() ?? 0 }, (_, i) => String(arr?.get(i))));
    };
    const off = listed('OFF');
    const on = listed('ON');
    const baseOff = nameOf(config?.get(N('BaseState'))) === 'OFF';
    for (let i = 0; i < groups.size(); i++) {
      const ref = String(groups.get(i));
      const group = resolve(doc, groups.get(i));
      const name = group instanceof PDFDict ? (textOf(resolve(doc, group.get(N('Name')))) ?? '') : '';
      layers.push({ name, hidden: off.has(ref) || (baseOff && !on.has(ref)) });
    }
  }

  return {
    details: detailList,
    xmp: details.xmp.state,
    attachments,
    formFields,
    comments,
    actions: finder.found,
    bookmarks: countOutline(readOutline(doc)),
    layers,
    links: { web: [...web], ...links },
    encrypted: details.encrypted,
  };
}

/** Details and contents of a PDF. */
export async function inspectPdf(source: SourceInput): Promise<FileReport> {
  const doc = await openSource(source);
  const details = readDetails(doc, source.bytes);
  return { details, carries: readCarries(doc, details) };
}
