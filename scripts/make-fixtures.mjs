// Generates every test PDF into tests/fixtures/out/. No real documents are ever used.
//   node scripts/make-fixtures.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PDFDocument, PDFName, PDFString, StandardFonts } from '@cantoo/pdf-lib';

const OUT = path.resolve('tests/fixtures/out');
mkdirSync(OUT, { recursive: true });

export const PROTECTED_PASSWORD = 'open-sesame';

function lines(page, font, texts, { top = 740, size = 12 } = {}) {
  texts.forEach((t, i) => page.drawText(t, { x: 54, y: top - i * (size + 6), size, font }));
}

function linkTo(doc, page, rect, target) {
  return doc.context.register(
    doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: rect, Border: [0, 0, 0], Dest: [target.ref, PDFName.of('Fit')] }),
  );
}

function uriLink(doc, rect, uri) {
  return doc.context.register(
    doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: rect, Border: [0, 0, 0], A: { S: 'URI', URI: PDFString.of(uri) } }),
  );
}

function jsLink(doc, rect, js) {
  return doc.context.register(
    doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: rect, Border: [0, 0, 0], A: { S: 'JavaScript', JS: PDFString.of(js) } }),
  );
}

async function normal() {
  const doc = await PDFDocument.create();
  doc.setTitle('ScribeForge test document');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = [1, 2, 3].map(() => doc.addPage([612, 792]));
  lines(pages[0], font, [
    'ScribeForge test document, page 1',
    'The forge keeps an anvil by the door.',
    'Go to page 3 (internal link)',
    'Visit the example website (web link)',
    'Copy this line: quill and anvil 0O1lI',
  ]);
  lines(pages[1], font, ['Page 2', 'A second anvil stands in the corner.', 'Nothing else on this page.']);
  lines(pages[2], font, ['Page 3', 'The third anvil is the oldest.', 'The fourth anvil is new.', 'End of the test document.']);
  pages[0].node.set(
    PDFName.of('Annots'),
    doc.context.obj([linkTo(doc, pages[0], [54, 696, 300, 712], pages[2]), uriLink(doc, [54, 678, 300, 694], 'https://example.com/scribeforge-test')]),
  );
  const outlines = doc.context.nextRef();
  const item = doc.context.nextRef();
  doc.context.assign(item, doc.context.obj({ Title: PDFString.of('Page 2'), Parent: outlines, Dest: [pages[1].ref, PDFName.of('Fit')] }));
  doc.context.assign(outlines, doc.context.obj({ Type: 'Outlines', First: item, Last: item, Count: 1 }));
  doc.catalog.set(PDFName.of('Outlines'), outlines);
  return doc.save();
}

async function large() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let n = 1; n <= 600; n++) {
    const page = doc.addPage([612, 792]);
    lines(page, font, [`Large test document, page ${n} of 600`, ...Array.from({ length: 30 }, (_, i) => `Line ${i + 1} of page ${n}: the quick brown fox jumps over the lazy dog.`)]);
  }
  return doc.save();
}

async function protectedFile() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  lines(doc.addPage([612, 792]), font, ['Protected test document', 'You can only read this with the password.']);
  lines(doc.addPage([612, 792]), font, ['Protected page 2']);
  doc.encrypt({ userPassword: PROTECTED_PASSWORD, ownerPassword: 'owner-only-password' });
  return doc.save();
}

async function scripted() {
  // Every way a PDF can try to run JavaScript: on open, on page open, from a link, and from the
  // document's script list. Each script tries a dialog and an internet request.
  const js = "app.alert('SCRIPT RAN'); app.launchURL('https://example.com/scribeforge-script-ran', true); this.submitForm({cURL: 'https://example.com/scribeforge-script-submit'});";
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  lines(page, font, ['Scripted test document', 'This file contains JavaScript. ScribeForge must never run it.', 'Script link: clicking here must do nothing']);
  page.node.set(PDFName.of('Annots'), doc.context.obj([jsLink(doc, [54, 702, 330, 718], js)]));
  page.node.set(PDFName.of('AA'), doc.context.obj({ O: { S: 'JavaScript', JS: PDFString.of(js) } }));
  doc.catalog.set(PDFName.of('OpenAction'), doc.context.obj({ S: 'JavaScript', JS: PDFString.of(js) }));
  const action = doc.context.register(doc.context.obj({ S: 'JavaScript', JS: PDFString.of(js) }));
  doc.catalog.set(PDFName.of('Names'), doc.context.obj({ JavaScript: { Names: [PDFString.of('test'), action] } }));
  return doc.save();
}

const normalBytes = await normal();
const files = {
  'normal.pdf': normalBytes,
  'large.pdf': await large(),
  'protected.pdf': await protectedFile(),
  'scripted.pdf': await scripted(),
  // Cut off halfway through.
  'damaged-truncated.pdf': normalBytes.slice(0, Math.floor(normalBytes.length / 2)),
  // The cross-reference table's position points nowhere.
  'damaged-xref.pdf': Buffer.from(Buffer.from(normalBytes).toString('latin1').replace(/startxref\s+\d+/, 'startxref\n99999999'), 'latin1'),
  // Not a PDF at all.
  'not-a-pdf.pdf': Buffer.from('This is a plain text file with a .pdf name.\n', 'utf8'),
};

for (const [name, bytes] of Object.entries(files)) writeFileSync(path.join(OUT, name), bytes);
console.log(`Test PDFs written to ${OUT}: ${Object.keys(files).join(', ')}`);
