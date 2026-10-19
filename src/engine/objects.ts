// Low-level helpers for walking a PDF's objects: following references, resolving destinations,
// cutting references to pages that aren't in the document, and sweeping out leftovers.
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNull,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFStream,
  PDFString,
  type PDFObject,
} from '@cantoo/pdf-lib';
import type { SourceInput } from './types';

export const N = (name: string) => PDFName.of(name);

/**
 * Loads a source PDF. Files locked only against changes (they open without asking for a
 * password) are opened with the empty password, as every PDF reader does.
 */
export function openSource(source: SourceInput): Promise<PDFDocument> {
  return PDFDocument.load(source.bytes, { password: source.password ?? '', updateMetadata: false });
}

export function nameOf(obj: PDFObject | undefined): string | undefined {
  return obj instanceof PDFName ? obj.decodeText() : undefined;
}

export function textOf(obj: PDFObject | undefined): string | undefined {
  return obj instanceof PDFString || obj instanceof PDFHexString ? obj.decodeText() : undefined;
}

export function resolve(doc: PDFDocument, obj: PDFObject | undefined): PDFObject | undefined {
  return obj instanceof PDFRef ? doc.context.lookup(obj) : obj;
}

export function isPageDict(obj: PDFObject | undefined): obj is PDFDict {
  return obj instanceof PDFDict && nameOf(obj.get(N('Type'))) === 'Page';
}

/** A destination's target page (0-based) and the rest of it (how to fit the page). */
export interface DestTarget {
  index: number;
  rest: PDFObject[];
}

/** Looks a named destination up in the document's /Dests dictionary or /Names /Dests tree. */
function namedDestination(doc: PDFDocument, name: string): PDFObject | undefined {
  const old = doc.catalog.lookupMaybe(N('Dests'), PDFDict);
  const fromOld = old?.get(N(name));
  if (fromOld) return resolve(doc, fromOld);
  const names = doc.catalog.lookupMaybe(N('Names'), PDFDict);
  const tree = names?.lookupMaybe(N('Dests'), PDFDict);
  if (!tree) return undefined;
  const seen = new Set<PDFDict>();
  const search = (node: PDFDict): PDFObject | undefined => {
    if (seen.has(node) || seen.size > 10_000) return undefined;
    seen.add(node);
    const pairs = node.lookupMaybe(N('Names'), PDFArray);
    if (pairs) {
      for (let i = 0; i + 1 < pairs.size(); i += 2) {
        if (textOf(resolve(doc, pairs.get(i))) === name) return resolve(doc, pairs.get(i + 1));
      }
    }
    const kids = node.lookupMaybe(N('Kids'), PDFArray);
    if (kids) {
      for (let i = 0; i < kids.size(); i++) {
        const kid = kids.lookup(i);
        if (kid instanceof PDFDict) {
          const found = search(kid);
          if (found) return found;
        }
      }
    }
    return undefined;
  };
  return search(tree);
}

/**
 * Works out which page a destination points to. Handles explicit destinations
 * ([page /Fit ...]), named destinations (by name or string), and destination dictionaries.
 */
export function destinationTarget(
  doc: PDFDocument,
  dest: PDFObject | undefined,
  pageIndexByRef: Map<string, number>,
  depth = 0,
): DestTarget | undefined {
  if (depth > 5) return undefined;
  const d = resolve(doc, dest);
  if (d instanceof PDFName || d instanceof PDFString || d instanceof PDFHexString) {
    const name = d instanceof PDFName ? d.decodeText() : d.decodeText();
    return destinationTarget(doc, namedDestination(doc, name), pageIndexByRef, depth + 1);
  }
  if (d instanceof PDFDict) return destinationTarget(doc, d.get(N('D')), pageIndexByRef, depth + 1);
  if (!(d instanceof PDFArray) || d.size() === 0) return undefined;
  const first = d.get(0);
  let index: number | undefined;
  if (first instanceof PDFRef) index = pageIndexByRef.get(first.toString());
  else if (first instanceof PDFNumber) index = first.asNumber();
  if (index === undefined || !Number.isInteger(index) || index < 0) return undefined;
  const rest: PDFObject[] = [];
  for (let i = 1; i < d.size(); i++) {
    const v = d.get(i);
    // Only plain values: fit type and coordinates. Anything else is dropped.
    if (v instanceof PDFName || v instanceof PDFNumber || v === PDFNull) rest.push(v);
  }
  return { index, rest };
}

/** Every object reachable from the document's trailer (Root, Info, Encrypt). */
export function reachableRefs(doc: PDFDocument): Set<string> {
  const ctx = doc.context;
  const seen = new Set<string>();
  const stack: PDFObject[] = [ctx.trailerInfo.Root, ctx.trailerInfo.Info, ctx.trailerInfo.Encrypt].filter(
    (o): o is PDFObject => o !== undefined,
  );
  while (stack.length > 0) {
    const o = stack.pop() as PDFObject;
    if (o instanceof PDFRef) {
      const key = o.toString();
      if (seen.has(key)) continue;
      seen.add(key);
      const target = ctx.lookup(o);
      if (target) stack.push(target);
    } else if (o instanceof PDFDict) {
      for (const [, v] of o.entries()) stack.push(v);
    } else if (o instanceof PDFArray) {
      for (let i = 0; i < o.size(); i++) stack.push(o.get(i));
    } else if (o instanceof PDFStream || o instanceof PDFRawStream) {
      stack.push(o.dict);
    }
  }
  return seen;
}

/** Deletes every object nothing in the document refers to. Returns how many were removed. */
export function sweepUnreachable(doc: PDFDocument): number {
  const keep = reachableRefs(doc);
  let removed = 0;
  for (const [ref] of doc.context.enumerateIndirectObjects()) {
    if (!keep.has(ref.toString())) {
      doc.context.delete(ref);
      removed++;
    }
  }
  return removed;
}

/**
 * Final safety check: any reference to a page that isn't in the document's page list is replaced
 * with null, so the sweep can remove that page and its content. Returns how many were cut.
 */
export function cutStrayPageReferences(doc: PDFDocument): number {
  const ctx = doc.context;
  const inTree = new Set(doc.getPages().map((p) => p.ref.toString()));
  const seen = new Set<string>();
  let cut = 0;
  const isStray = (o: PDFObject): boolean => o instanceof PDFRef && !inTree.has(o.toString()) && isPageDict(ctx.lookup(o));

  const visit = (o: PDFObject | undefined): void => {
    if (o === undefined) return;
    if (o instanceof PDFRef) {
      const key = o.toString();
      if (seen.has(key)) return;
      seen.add(key);
      visit(ctx.lookup(o));
    } else if (o instanceof PDFDict) {
      for (const [k, v] of o.entries()) {
        if (isStray(v)) {
          o.set(k, PDFNull);
          cut++;
        } else visit(v);
      }
    } else if (o instanceof PDFArray) {
      for (let i = 0; i < o.size(); i++) {
        const v = o.get(i);
        if (isStray(v)) {
          o.set(i, PDFNull);
          cut++;
        } else visit(v);
      }
    } else if (o instanceof PDFStream || o instanceof PDFRawStream) {
      visit(o.dict);
    }
  };
  visit(ctx.trailerInfo.Root);
  visit(ctx.trailerInfo.Info);
  return cut;
}

/**
 * Every entry of a name tree (where a document keeps attachments, document scripts and named
 * destinations), as [name, value] pairs. Loops and very large trees are cut short.
 */
export function nameTreeEntries(doc: PDFDocument, tree: PDFDict | undefined, limit = 10_000): [string, PDFObject][] {
  const out: [string, PDFObject][] = [];
  if (!tree) return out;
  const seen = new Set<PDFDict>();
  const visit = (node: PDFDict, depth: number) => {
    if (seen.has(node) || depth > 30 || out.length >= limit) return;
    seen.add(node);
    const pairs = node.lookupMaybe(N('Names'), PDFArray);
    if (pairs) {
      for (let i = 0; i + 1 < pairs.size() && out.length < limit; i += 2) {
        out.push([textOf(resolve(doc, pairs.get(i))) ?? '', resolve(doc, pairs.get(i + 1)) as PDFObject]);
      }
    }
    const kids = node.lookupMaybe(N('Kids'), PDFArray);
    for (let i = 0; i < (kids?.size() ?? 0); i++) {
      const kid = kids?.lookup(i);
      if (kid instanceof PDFDict) visit(kid, depth + 1);
    }
  };
  visit(tree, 0);
  return out;
}
