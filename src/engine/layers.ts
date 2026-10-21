// Layers (PDF "optional content"). A layer's on/off settings live in the document, not on its
// pages, so copying pages alone loses them, and a layer hidden in the original would show in the
// new file. This copies the settings across, using the same copier as the pages so the layers
// the pages refer to and the layers the settings list are the same objects.
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFObjectCopier, PDFString, type PDFObject } from '@cantoo/pdf-lib';
import { N, nameOf, resolve } from './objects';

export interface LayerSource {
  /** File name, used to label each file's layers when files are merged. */
  name: string;
  doc: PDFDocument;
  copier: PDFObjectCopier;
  /** Only these layers (by reference in the source), for redaction: the ones kept pages use. */
  keep?: Set<string>;
}

/** Copies the layer settings of every source that has layers into `out`. */
export function copyLayers(out: PDFDocument, sources: LayerSource[]): void {
  const withLayers = sources.filter((s) => s.doc.catalog.lookupMaybe(N('OCProperties'), PDFDict)?.has(N('OCGs')));
  if (withLayers.length === 0) return;
  const filtered = withLayers.some((s) => s.keep);

  if (withLayers.length === 1 && !filtered) {
    const { doc, copier } = withLayers[0];
    out.catalog.set(N('OCProperties'), copier.copy(doc.catalog.get(N('OCProperties')) as PDFObject));
    return;
  }

  // Several files (or only some layers): one list of layers, each file's hidden layers stay
  // hidden, and each file's layers are grouped under its name in the reader's layer panel.
  const groups: PDFObject[] = [];
  const off: PDFObject[] = [];
  const order: PDFObject[] = [];
  const locked: PDFObject[] = [];
  const radio: PDFObject[] = [];
  const auto: PDFObject[] = [];
  for (const { name, doc, copier, keep } of withLayers) {
    const kept = (o: PDFObject) => !keep || keep.has(String(o));
    const oc = doc.catalog.lookupMaybe(N('OCProperties'), PDFDict) as PDFDict;
    const config = oc.lookupMaybe(N('D'), PDFDict);
    const items = (key: string, from: PDFDict | undefined = config) => {
      const arr = resolve(doc, from?.get(N(key)));
      return arr instanceof PDFArray ? Array.from({ length: arr.size() }, (_, i) => arr.get(i)) : [];
    };
    /** The layer panel's order, without layers that aren't kept (and groups left empty). */
    const filterOrder = (list: PDFObject[], depth = 0): PDFObject[] =>
      list.flatMap((o) => {
        const value = resolve(doc, o);
        if (value instanceof PDFString || value instanceof PDFHexString) return [copier.copy(value)];
        if (value instanceof PDFArray && depth < 20) {
          const inner = filterOrder(Array.from({ length: value.size() }, (_, i) => value.get(i)), depth + 1);
          return inner.some((x) => !(x instanceof PDFString || x instanceof PDFHexString)) ? [out.context.obj(inner)] : [];
        }
        return kept(o) ? [copier.copy(o)] : [];
      });

    const baseOff = nameOf(config?.get(N('BaseState'))) === 'OFF';
    const offSet = new Set(items('OFF').map(String));
    const onSet = new Set(items('ON').map(String));
    for (const group of items('OCGs', oc)) {
      if (!kept(group)) continue;
      const copied = copier.copy(group);
      groups.push(copied);
      if (offSet.has(String(group)) || (baseOff && !onSet.has(String(group)))) off.push(copied);
    }
    const fileOrder = filterOrder(items('Order'));
    if (fileOrder.length > 0) order.push(out.context.obj([PDFString.of(name.replace(/\.pdf$/i, '')), ...fileOrder]));
    locked.push(...items('Locked').filter(kept).map((o) => copier.copy(o)));
    for (const group of items('RBGroups')) {
      const members = resolve(doc, group);
      if (!(members instanceof PDFArray)) continue;
      const list = Array.from({ length: members.size() }, (_, i) => members.get(i)).filter(kept);
      if (list.length > 1) radio.push(out.context.obj(list.map((o) => copier.copy(o))));
    }
    if (!keep) auto.push(...items('AS').map((o) => copier.copy(o)));
  }
  if (groups.length === 0) return;
  const config = out.context.obj({ BaseState: 'ON' }) as PDFDict;
  if (off.length > 0) config.set(N('OFF'), out.context.obj(off));
  if (order.length > 0) config.set(N('Order'), out.context.obj(order));
  if (locked.length > 0) config.set(N('Locked'), out.context.obj(locked));
  if (radio.length > 0) config.set(N('RBGroups'), out.context.obj(radio));
  if (auto.length > 0) config.set(N('AS'), out.context.obj(auto));
  out.catalog.set(N('OCProperties'), out.context.obj({ OCGs: groups, D: config }));
}
