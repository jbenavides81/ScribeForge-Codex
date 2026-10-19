// Layers (PDF "optional content"). A layer's on/off settings live in the document, not on its
// pages, so copying pages alone loses them, and a layer hidden in the original would show in the
// new file. This copies the settings across, using the same copier as the pages so the layers
// the pages refer to and the layers the settings list are the same objects.
import { PDFArray, PDFDict, PDFDocument, PDFObjectCopier, PDFString, type PDFObject } from '@cantoo/pdf-lib';
import { N, nameOf, resolve } from './objects';

export interface LayerSource {
  /** File name, used to label each file's layers when files are merged. */
  name: string;
  doc: PDFDocument;
  copier: PDFObjectCopier;
}

/** Copies the layer settings of every source that has layers into `out`. */
export function copyLayers(out: PDFDocument, sources: LayerSource[]): void {
  const withLayers = sources.filter((s) => s.doc.catalog.lookupMaybe(N('OCProperties'), PDFDict)?.has(N('OCGs')));
  if (withLayers.length === 0) return;

  if (withLayers.length === 1) {
    const { doc, copier } = withLayers[0];
    out.catalog.set(N('OCProperties'), copier.copy(doc.catalog.get(N('OCProperties')) as PDFObject));
    return;
  }

  // Several files: one list of layers, each file's hidden layers stay hidden, and each file's
  // layers are grouped under its name in the reader's layer panel.
  const groups: PDFObject[] = [];
  const off: PDFObject[] = [];
  const order: PDFObject[] = [];
  const locked: PDFObject[] = [];
  const radio: PDFObject[] = [];
  const auto: PDFObject[] = [];
  for (const { name, doc, copier } of withLayers) {
    const oc = doc.catalog.lookupMaybe(N('OCProperties'), PDFDict) as PDFDict;
    const config = oc.lookupMaybe(N('D'), PDFDict);
    const items = (key: string, from: PDFDict | undefined = config) => {
      const arr = resolve(doc, from?.get(N(key)));
      return arr instanceof PDFArray ? Array.from({ length: arr.size() }, (_, i) => arr.get(i)) : [];
    };
    const baseOff = nameOf(config?.get(N('BaseState'))) === 'OFF';
    const offSet = new Set(items('OFF').map(String));
    const onSet = new Set(items('ON').map(String));
    for (const group of items('OCGs', oc)) {
      const copied = copier.copy(group);
      groups.push(copied);
      if (offSet.has(String(group)) || (baseOff && !onSet.has(String(group)))) off.push(copied);
    }
    const fileOrder = items('Order').map((o) => copier.copy(o));
    if (fileOrder.length > 0) order.push(out.context.obj([PDFString.of(name.replace(/\.pdf$/i, '')), ...fileOrder]));
    locked.push(...items('Locked').map((o) => copier.copy(o)));
    radio.push(...items('RBGroups').map((o) => copier.copy(o)));
    auto.push(...items('AS').map((o) => copier.copy(o)));
  }
  const config = out.context.obj({ BaseState: 'ON' }) as PDFDict;
  if (off.length > 0) config.set(N('OFF'), out.context.obj(off));
  if (order.length > 0) config.set(N('Order'), out.context.obj(order));
  if (locked.length > 0) config.set(N('Locked'), out.context.obj(locked));
  if (radio.length > 0) config.set(N('RBGroups'), out.context.obj(radio));
  if (auto.length > 0) config.set(N('AS'), out.context.obj(auto));
  out.catalog.set(N('OCProperties'), out.context.obj({ OCGs: groups, D: config }));
}
