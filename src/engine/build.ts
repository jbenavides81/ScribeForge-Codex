// Builds a new PDF from pages of one or more source PDFs: the core of merge, split, extract,
// reorder, rotate, delete and insert blank page.
//
// The safety rules (Phase 0 plan, section 11):
// 1. Every result is a brand-new document. Sources are only read.
// 2. Before copying, every link and bookmark that points to another page is turned into a
//    placeholder that names the page instead of referring to it, so copying a page can never drag
//    another page (or its text) into the new file. Afterwards placeholders become links to the
//    right page of the new file, or are removed if that page isn't in it.
// 3. Scripts and other risky actions are removed; form fields keep their look but are detached.
// 4. A final check cuts any remaining reference to a page outside the page list, and everything
//    no longer reachable is swept out before saving.
// 5. The new file's details are written twice, in the classic details and a fresh XMP copy, so
//    the two always agree and nothing old from either is carried over.
// 6. Redacting: marked pages are replaced by images of themselves with the marks blacked out,
//    and the new file keeps only pages and the links between them (Phase 0 plan, section 9).
import { degrees, PDFArray, PDFDict, PDFDocument, PDFObjectCopier, PDFPage, PDFString, type PDFObject, type PDFRef } from '@cantoo/pdf-lib';
import { addAnnotations, type Fonts } from './annotate';
import { applyFileChanges, collectMarked } from './fileAnnots';
import { flattenPage } from './flatten';
import { countOutline, documentActions, readInfo, readXmpFrom } from './inspect';
import { copyLayers } from './layers';
import { cutStrayPageReferences, destinationTarget, N, nameOf, nameTreeEntries, openSource, sweepUnreachable } from './objects';
import { readOutline, writeOutline, type OutlineNode, type PlacedBookmark } from './outline';
import { imagePage, layersUsed, pruneUnusedXObjects, termsFound } from './redact';
import {
  emptyReport,
  type AnnotationInput,
  type BuildOptions,
  type BuildReport,
  type DocInfo,
  type PageItem,
  type Rotation,
  type SourceInput,
} from './types';
import { writeXmp } from './xmp';

const PLACEHOLDER = 'ScribeForge-page:';

/** Annotation actions that are kept. Everything else (JavaScript, Launch, SubmitForm, …) goes. */
const KEPT_ACTIONS = new Set(['URI', 'GoTo', 'Named']);

function placeholder(sourceId: string, index: number): PDFString {
  return PDFString.of(`${PLACEHOLDER}${sourceId}:${index}`);
}

function readPlaceholder(obj: PDFObject | undefined): { source: string; index: number } | undefined {
  if (!(obj instanceof PDFString)) return undefined;
  const text = obj.decodeText();
  if (!text.startsWith(PLACEHOLDER)) return undefined;
  const rest = text.slice(PLACEHOLDER.length);
  const cut = rest.lastIndexOf(':');
  return { source: rest.slice(0, cut), index: Number(rest.slice(cut + 1)) };
}

/** Rule 2 and 3, applied to the source pages that will be copied. Changes the loaded copy only. */
function prepareSourcePages(doc: PDFDocument, sourceId: string, indices: number[], report: BuildReport, redacting: boolean): void {
  const pages = doc.getPages();
  const pageIndexByRef = new Map(pages.map((p, i) => [p.ref.toString(), i]));
  // Every annotation on a page being copied: a reply can keep pointing at one of these (on its
  // own page or another), since the same copier brings both over. Pointing anywhere else, it's
  // just a comment, so copying it can't drag in a page that isn't in the new file.
  const copiedAnnots = new Set<string>();
  for (const index of indices) for (const raw of pages[index].node.lookupMaybe(N('Annots'), PDFArray)?.asArray() ?? []) copiedAnnots.add(String(raw));
  for (const index of indices) {
    const node = pages[index].node;
    node.delete(N('AA')); // page open/close actions
    node.delete(N('B')); // article threads, which point at other pages
    if (redacting) {
      // Data other programs keep with a page, out of sight.
      node.delete(N('Metadata'));
      node.delete(N('PieceInfo'));
    }
    const annots = node.lookupMaybe(N('Annots'), PDFArray);
    if (!annots) continue;
    const keep: PDFObject[] = [];
    for (let k = 0; k < annots.size(); k++) {
      const raw = annots.get(k);
      const annot = annots.lookup(k);
      if (!(annot instanceof PDFDict)) continue;
      const subtype = nameOf(annot.get(N('Subtype')));
      if (redacting && subtype !== 'Link') {
        // A redacted file keeps links between pages and nothing else.
        if (subtype === 'Widget') report.formFieldsLeftOut++;
        else if (subtype === 'FileAttachment') report.attachmentsLeftOut++;
        else if (subtype !== 'Popup') report.commentsLeftOut++;
        continue;
      }
      annot.delete(N('P'));
      annot.delete(N('AA'));
      if (annot.has(N('IRT')) && !copiedAnnots.has(String(annot.get(N('IRT'))))) annot.delete(N('IRT'));
      if (subtype === 'Widget' && annot.has(N('Parent'))) {
        annot.delete(N('Parent'));
        report.formFieldsDetached++;
      }

      let dest = annot.get(N('Dest'));
      const action = annot.lookupMaybe(N('A'), PDFDict);
      if (action) {
        const kind = nameOf(action.get(N('S')));
        if (kind === 'GoTo' && !dest) {
          dest = action.get(N('D'));
          annot.delete(N('A'));
        } else if (!KEPT_ACTIONS.has(kind ?? '')) {
          annot.delete(N('A'));
          report.actionsRemoved++;
          if (subtype === 'Link' && !dest) continue; // a link that only ran a script
        }
      }
      if (dest) {
        const target = destinationTarget(doc, dest, pageIndexByRef);
        if (!target) {
          report.linksRemoved++;
          if (subtype === 'Link') continue;
          annot.delete(N('Dest'));
        } else {
          annot.set(N('Dest'), doc.context.obj([placeholder(sourceId, target.index), ...target.rest]) as PDFArray);
        }
      }
      keep.push(raw);
    }
    node.set(N('Annots'), doc.context.obj(keep));
  }
}

/** Turns placeholders on a new page into real links, or removes links to pages not in the file. */
function resolvePlaceholders(out: PDFDocument, page: PDFPage, where: Map<string, PDFPage>, report: BuildReport): void {
  const annots = page.node.lookupMaybe(N('Annots'), PDFArray);
  if (!annots) return;
  const keep: PDFObject[] = [];
  for (let k = 0; k < annots.size(); k++) {
    const raw = annots.get(k);
    const annot = annots.lookup(k);
    if (!(annot instanceof PDFDict)) continue;
    annot.set(N('P'), page.ref);
    const dest = annot.lookupMaybe(N('Dest'), PDFArray);
    const marker = dest ? readPlaceholder(dest.get(0)) : undefined;
    if (dest && marker) {
      const target = where.get(`${marker.source}:${marker.index}`);
      if (target) {
        dest.set(0, target.ref);
        report.linksKept++;
      } else {
        report.linksRemoved++;
        continue;
      }
    }
    keep.push(raw);
  }
  page.node.set(N('Annots'), out.context.obj(keep));
}

function placeBookmarks(nodes: OutlineNode[], sourceId: string, where: Map<string, PDFPage>, report: BuildReport): PlacedBookmark[] {
  const placed: PlacedBookmark[] = [];
  for (const node of nodes) {
    const children = placeBookmarks(node.children, sourceId, where, report);
    const page = node.target ? where.get(`${sourceId}:${node.target.index}`) : undefined;
    if (page) {
      placed.push({ title: node.title, page: page.ref, rest: node.target?.rest, children });
      report.bookmarksKept++;
    } else if (!node.target && children.length > 0) {
      placed.push({ title: node.title, children }); // a heading that groups other bookmarks
    } else {
      if (node.target) report.bookmarksRemoved++;
      placed.push(...children); // its sub-bookmarks move up a level
    }
  }
  return placed;
}

function normalise(angle: number): Rotation {
  return ((((Math.round(angle / 90) * 90) % 360) + 360) % 360) as Rotation;
}

/** A date from XMP, if it reads as one. */
function xmpDateValue(text: string | undefined): Date | undefined {
  const date = text ? new Date(text) : undefined;
  return date && !Number.isNaN(date.getTime()) ? date : undefined;
}

/**
 * Writes the new file's details: the classic ones and a matching XMP copy. Title, author,
 * subject and keywords come from `details` when given (the Details screen always gives them),
 * otherwise from `first`; the program that made the original and when stay as they were.
 */
function writeDetails(out: PDFDocument, first: PDFDocument | undefined, options: BuildOptions): void {
  const now = options.now ?? new Date();
  const info = first ? readInfo(first) : undefined;
  const xmp = first ? readXmpFrom(first) : undefined;
  const fromXmp = xmp?.state === 'read' ? xmp.values : {};
  const details: DocInfo = options.details ?? {
    title: info?.title || fromXmp.title || '',
    author: info?.author || fromXmp.author || '',
    subject: info?.subject || fromXmp.subject || '',
    keywords: info?.keywords || fromXmp.keywords || '',
  };
  const creator = info?.creator || fromXmp.creatorTool || 'ScribeForge';
  const producer = options.producer ?? 'ScribeForge';
  const created = info?.created ?? xmpDateValue(fromXmp.createDate) ?? now;

  if (details.title) out.setTitle(details.title);
  if (details.author) out.setAuthor(details.author);
  if (details.subject) out.setSubject(details.subject);
  if (details.keywords) out.setKeywords([details.keywords]);
  out.setCreator(creator);
  out.setProducer(producer);
  out.setCreationDate(created);
  out.setModificationDate(now);

  const packet = writeXmp({ ...details, producer, creatorTool: creator, created, modified: now });
  const stream = out.context.stream(new TextEncoder().encode(packet), { Type: 'Metadata', Subtype: 'XML' });
  out.catalog.set(N('Metadata'), out.context.register(stream));
}

export async function buildPdf(
  sources: SourceInput[],
  items: PageItem[],
  annotations: AnnotationInput[] = [],
  options: BuildOptions = {},
): Promise<{ bytes: Uint8Array; report: BuildReport; found: string[] }> {
  if (items.length === 0) throw new Error('A PDF needs at least one page.');
  const report = emptyReport();
  const redact = options.redact;
  const redacting = redact !== undefined;
  const redacted = (source: string, index: number) => redact?.[`${source}:${index}`];

  // Which pages of which sources are needed, in order of first use.
  const needed = new Map<string, number[]>();
  for (const item of items) {
    if (item.kind !== 'page') continue;
    const list = needed.get(item.source) ?? [];
    if (!list.includes(item.index)) list.push(item.index);
    needed.set(item.source, list);
  }

  const docs = new Map<string, PDFDocument>();
  const outlines = new Map<string, OutlineNode[]>();
  for (const id of needed.keys()) {
    const source = sources.find((s) => s.id === id);
    if (!source) throw new Error(`Unknown source ${id}`);
    const doc = await openSource(source);
    const count = doc.getPageCount();
    for (const index of needed.get(id) as number[]) {
      if (!Number.isInteger(index) || index < 0 || index >= count) throw new Error(`${source.name} has no page ${index + 1}`);
    }
    outlines.set(id, readOutline(doc));
    if (redacting) report.bookmarksLeftOut += countOutline(outlines.get(id) ?? []);
    // Whole-document scripts and attachments aren't copied: pages are. The report says so.
    report.actionsRemoved += documentActions(doc).length;
    const names = doc.catalog.lookupMaybe(N('Names'), PDFDict);
    report.attachmentsLeftOut += nameTreeEntries(doc, names?.lookupMaybe(N('EmbeddedFiles'), PDFDict)).length;
    const copied = (needed.get(id) as number[]).filter((index) => !redacted(id, index));
    prepareSourcePages(doc, id, copied, report, redacting);
    if (!redacting) {
      // Changes to the file's own annotations, made on this loaded copy before its pages are copied.
      const replyTargets = new Set(annotations.flatMap((a) => (a.kind === 'reply' && a.source === id && a.replyTo.startsWith('file:') ? [a.replyTo.slice(5)] : [])));
      await applyFileChanges(doc, id, options.fileChanges ?? [], replyTargets, report);
    }
    docs.set(id, doc);
  }

  // Each source's pages are copied with one copier, which later copies its layer settings too,
  // so both refer to the same copied layers.
  const out = await PDFDocument.create({ updateMetadata: false });
  const copies = new Map<string, Map<number, PDFPage>>();
  const copiers = new Map<string, PDFObjectCopier>();
  const keepLayers = new Map<string, Set<string>>();
  for (const [id, all] of needed) {
    const doc = docs.get(id) as PDFDocument;
    const copier = PDFObjectCopier.for(doc.context, out.context);
    copiers.set(id, copier);
    const sourcePages = doc.getPages();
    const indices = all.filter((index) => !redacted(id, index)); // marked pages are never copied
    if (redacting) keepLayers.set(id, layersUsed(doc, indices.map((index) => sourcePages[index].node)));
    const pages = indices.map((index) => {
      const node = copier.copy(sourcePages[index].node);
      return PDFPage.of(node, out.context.register(node), out);
    });
    copies.set(id, new Map(indices.map((index, i) => [index, pages[i]])));
  }

  const used = new Set<PDFPage>();
  const where = new Map<string, PDFPage>(); // "source:index" → its first page in the new file
  const placedPages: PDFPage[] = [];
  for (const item of items) {
    if (item.kind === 'blank') {
      placedPages.push(out.addPage([item.width, item.height]));
      continue;
    }
    const key = `${item.source}:${item.index}`;
    const image = redacted(item.source, item.index);
    if (image) {
      const own = (docs.get(item.source) as PDFDocument).getPage(item.index).getRotation().angle;
      const page = await imagePage(out, image, normalise(own + item.rotate));
      report.pagesRedacted++;
      if (!where.has(key)) where.set(key, page);
      placedPages.push(page);
      continue;
    }
    let page = copies.get(item.source)?.get(item.index) as PDFPage;
    // The same page twice: a separate copy (its layers, if any, are copied separately too).
    if (used.has(page)) [page] = await out.copyPages(docs.get(item.source) as PDFDocument, [item.index]);
    used.add(page);
    out.addPage(page);
    page.setRotation(degrees(normalise(page.getRotation().angle + item.rotate)));
    if (redacting) pruneUnusedXObjects(out, page);
    if (!where.has(key)) where.set(key, page);
    placedPages.push(page);
  }

  for (const page of placedPages) resolvePlaceholders(out, page, where, report);

  // Where the file's own annotations that new replies answer ended up.
  const inFile = new Map<string, PDFRef>();
  for (const page of placedPages) collectMarked(out, page.node.lookupMaybe(N('Annots'), PDFArray), inFile);

  // Annotations added in ScribeForge follow their page; those whose page isn't here are left out.
  // Replies go last, so what they answer is already in place.
  const fonts: Fonts = {};
  const added = new Map<string, PDFRef>();
  for (const pass of [annotations.filter((a) => a.kind !== 'reply'), annotations.filter((a) => a.kind === 'reply')]) {
    const byPage = new Map<string, AnnotationInput[]>();
    for (const a of pass) {
      const key = `${a.source}:${a.index}`;
      byPage.set(key, [...(byPage.get(key) ?? []), a]);
    }
    for (const [key, list] of byPage) {
      const page = redacting ? undefined : where.get(key);
      const count = page ? await addAnnotations(out, page, list, fonts, added, inFile) : 0;
      report.annotationsAdded += count;
      report.annotationsLeftOut += list.length - count;
    }
  }

  // Burning annotations into their pages, once all of them are in place.
  if (!redacting) for (const page of new Set(placedPages)) flattenPage(out, page, options.flattenAll ?? false, report);

  // Bookmarks: one source keeps its own; merged files each get a bookmark named after the file.
  // A redacted file has none.
  const sourceOrder = [...needed.keys()];
  if (redacting) {
    // left out, and counted above
  } else if (sourceOrder.length === 1) {
    writeOutline(out, placeBookmarks(outlines.get(sourceOrder[0]) ?? [], sourceOrder[0], where, report));
  } else {
    const top: PlacedBookmark[] = sourceOrder.map((id) => {
      const first = items.find((i) => i.kind === 'page' && i.source === id) as Extract<PageItem, { kind: 'page' }>;
      return {
        title: (sources.find((s) => s.id === id)?.name ?? id).replace(/\.pdf$/i, ''),
        page: where.get(`${id}:${first.index}`)?.ref,
        children: placeBookmarks(outlines.get(id) ?? [], id, where, report),
      };
    });
    writeOutline(out, top);
  }

  copyLayers(
    out,
    sourceOrder.map((id) => ({
      name: sources.find((s) => s.id === id)?.name ?? id,
      doc: docs.get(id) as PDFDocument,
      copier: copiers.get(id) as PDFObjectCopier,
      keep: keepLayers.get(id),
    })),
  );

  // Document details, and the document's language, from the first source. A redacted file has
  // no details of its own: only that ScribeForge made it, and when.
  const first = docs.get(sourceOrder[0]);
  if (redacting) {
    writeDetails(out, undefined, { ...options, details: { title: '', author: '', subject: '', keywords: '' } });
  } else {
    writeDetails(out, first, options);
    const lang = first?.catalog.get(N('Lang'));
    if (lang instanceof PDFString) out.catalog.set(N('Lang'), lang);
  }

  report.strayReferencesCut = cutStrayPageReferences(out);
  report.objectsSwept = sweepUnreachable(out);
  report.pages = placedPages.length;
  const bytes = await out.save({ useObjectStreams: true });
  const found = options.verifyTerms?.length ? await termsFound(bytes, options.verifyTerms) : [];
  return { bytes, report, found };
}
