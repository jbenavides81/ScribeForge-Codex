// What was added after a signature (docs/Plan_Sign.md, section 5): only other signatures count as
// harmless; anything else, however small, is "changed after signing", including the shapes known
// attacks use to hide a change in a later update.
import { PDFArray, PDFDocument, PDFHexString, PDFName, PDFString } from '@cantoo/pdf-lib';
import { beforeAll, describe, expect, it } from 'vitest';
import { laterChanges } from '../../src/engine/sign/changes';
import { checkSignatures } from '../../src/engine/sign/check';
import { signPdf, testIdentities, withEmptySignatureBox } from '../fixtures/signing';
import { fixture } from './support/inspect';

let ids: ReturnType<typeof testIdentities>;
let once: Uint8Array;
beforeAll(async () => {
  ids = testIdentities();
  once = await signPdf(fixture('normal.pdf'), ids.signer);
});

/** An update at the end of the file, made with `change`. */
async function update(bytes: Uint8Array, change: (doc: PDFDocument, save: (obj: unknown) => void) => void | Promise<void>): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { forIncrementalUpdate: true, updateMetadata: false });
  const snapshot = doc.takeSnapshot();
  await change(doc, (ref) => snapshot.markRefForSave(ref as never));
  const tail = await doc.saveIncremental(snapshot, { useObjectStreams: false });
  return new Uint8Array([...bytes, ...tail]);
}

const append = (bytes: Uint8Array, text: string) => new Uint8Array([...bytes, ...new TextEncoder().encode(text)]);
const firstStatus = async (bytes: Uint8Array) => (await checkSignatures(bytes, []))[0].status;

describe('after a signature', () => {
  it('nothing added at all: valid', async () => {
    expect(await laterChanges(once, once.length)).toEqual({ onlySignatures: true, signatures: 0 });
    expect(await firstStatus(append(once, '\n'))).toBe('valid');
  });

  it('another signature in an empty box the file had: only a signature was added', async () => {
    const form = await withEmptySignatureBox(fixture('normal.pdf'), 'Approver', [340, 40, 560, 100]);
    const first = await signPdf(form, ids.signer, { place: { kind: 'box', page: 1, rect: [60, 60, 300, 130], rotation: 0 } });
    const second = await signPdf(first, ids.ec, { place: { kind: 'field', field: 'Approver' } });
    expect((await checkSignatures(second, [])).map((c) => c.status)).toEqual(['signed-after', 'valid']);
  });

  it("the document's details changed: changed", async () => {
    const changed = await update(once, (doc, save) => {
      doc.setTitle('A NEW TITLE');
      save(doc.context.trailerInfo.Info);
    });
    expect(await firstStatus(changed)).toBe('changed');
  });

  it('a comment added: changed', async () => {
    const changed = await update(once, (doc, save) => {
      const page = doc.getPage(0);
      const note = doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Text', Rect: [50, 50, 70, 70], Contents: PDFHexString.fromText('Added later') }));
      page.node.lookup(PDFName.of('Annots'), PDFArray).push(note); // the page's links stay
      save(page.ref);
    });
    expect(await firstStatus(changed)).toBe('changed');
  });

  it('a new signature box with no signature, which could draw anything on the page: changed', async () => {
    const changed = await update(once, (doc, save) => {
      const page = doc.getPage(0);
      const look = doc.context.register(doc.context.formXObject([], { BBox: [0, 0, 600, 800] }));
      const widget = doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Widget', FT: 'Sig', T: PDFString.of('Overlay'), Rect: [0, 0, 600, 800], AP: { N: look } }));
      page.node.set(PDFName.of('Annots'), doc.context.obj([widget]));
      save(page.ref);
      const form = doc.catalog.lookup(PDFName.of('AcroForm'));
      (form as never as { lookup(n: PDFName): { push(v: unknown): void } }).lookup(PDFName.of('Fields')).push(widget);
      save(doc.catalog.get(PDFName.of('AcroForm')));
    });
    expect(await firstStatus(changed)).toBe('changed');
  });

  it('the file pointed at a different catalog (a different document): changed', async () => {
    const changed = await update(once, (doc) => {
      const copy = doc.context.register(doc.catalog.clone(doc.context));
      doc.context.trailerInfo.Root = copy;
    });
    expect(await firstStatus(changed)).toBe('changed');
  });

  it('an object written twice in the same update, which readers may read differently: changed', async () => {
    const tricky = append(once, '\n9000 0 obj\n(first)\nendobj\n9000 0 obj\n(second)\nendobj\n%%EOF\n');
    expect(await laterChanges(tricky, once.length)).toEqual({ onlySignatures: false, signatures: 0 });
  });
});
