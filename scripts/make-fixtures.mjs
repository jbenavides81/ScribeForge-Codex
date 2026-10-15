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

// For the page tools (stop 1b): six pages, each with unique text, and every kind of thing that
// points from one page to another or runs code, so tests can prove nothing leaks or breaks.
async function links() {
  const doc = await PDFDocument.create();
  doc.setTitle('Links test document');
  doc.setAuthor('ScribeForge tests');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = [1, 2, 3, 4, 5, 6].map((n) => {
    const page = doc.addPage([612, 792]);
    lines(page, font, [`UNIQUE-PAGE-${n}`, `This is page ${n} of the links test document.`]);
    return page;
  });
  pages[1].node.set(PDFName.of('Rotate'), doc.context.obj(90)); // page 2 is already turned

  // Named destination "chapter-six" in the /Names /Dests tree.
  const chapterSix = doc.context.register(doc.context.obj([pages[5].ref, PDFName.of('XYZ'), 0, 792, 0]));
  doc.catalog.set(PDFName.of('Names'), doc.context.obj({ Dests: { Names: [PDFString.of('chapter-six'), chapterSix] } }));

  const goTo = (rect, target) =>
    doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: rect, Border: [0, 0, 0], A: { S: 'GoTo', D: [target.ref, PDFName.of('Fit')] } }));
  const named = (rect, name) =>
    doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: rect, Border: [0, 0, 0], Dest: PDFString.of(name) }));
  const launch = doc.context.register(
    doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [54, 600, 200, 616], Border: [0, 0, 0], A: { S: 'Launch', F: PDFString.of('calc.exe') } }),
  );
  const note1 = doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Text', Rect: [500, 700, 520, 720], Contents: PDFString.of('NOTE-ON-PAGE-1') }));
  pages[0].node.set(
    PDFName.of('Annots'),
    doc.context.obj([
      linkTo(doc, pages[0], [54, 700, 200, 716], pages[2]), // explicit → page 3
      named([54, 680, 200, 696], 'chapter-six'), // named → page 6
      goTo([54, 660, 200, 676], pages[1]), // GoTo action → page 2
      uriLink(doc, [54, 640, 200, 656], 'https://example.com/links-test'),
      jsLink(doc, [54, 620, 200, 636], "app.alert('SCRIPT RAN')"),
      launch,
      note1,
    ]),
  );
  pages[2].node.set(PDFName.of('AA'), doc.context.obj({ O: { S: 'JavaScript', JS: PDFString.of("app.alert('PAGE SCRIPT RAN')") } }));

  // One form field shown on two pages (4 and 5), with a value.
  const fieldRef = doc.context.nextRef();
  const widget = (page) =>
    doc.context.register(
      doc.context.obj({ Type: 'Annot', Subtype: 'Widget', Rect: [54, 500, 300, 520], Parent: fieldRef, P: page.ref, F: 4 }),
    );
  const w4 = widget(pages[3]);
  const w5 = widget(pages[4]);
  doc.context.assign(fieldRef, doc.context.obj({ FT: 'Tx', T: PDFString.of('account'), V: PDFString.of('FIELD-VALUE-SECRET'), Kids: [w4, w5] }));
  doc.catalog.set(PDFName.of('AcroForm'), doc.context.obj({ Fields: [fieldRef] }));
  pages[3].node.set(PDFName.of('Annots'), doc.context.obj([w4]));
  // A reply on page 5 to the note on page 1.
  const reply = doc.context.register(
    doc.context.obj({ Type: 'Annot', Subtype: 'Text', Rect: [500, 700, 520, 720], Contents: PDFString.of('REPLY-ON-PAGE-5'), IRT: note1 }),
  );
  pages[4].node.set(PDFName.of('Annots'), doc.context.obj([w5, reply]));

  // Bookmarks: Part A (page 1) > Page 2 (GoTo), Page 3; Part B (heading) > Chapter six (named), Page 5.
  const ctx = doc.context;
  const [root, partA, p2, p3, partB, six, p5] = [1, 2, 3, 4, 5, 6, 7].map(() => ctx.nextRef());
  ctx.assign(partA, ctx.obj({ Title: PDFString.of('Part A'), Parent: root, Next: partB, First: p2, Last: p3, Count: 2, Dest: [pages[0].ref, PDFName.of('Fit')] }));
  ctx.assign(p2, ctx.obj({ Title: PDFString.of('Page 2'), Parent: partA, Next: p3, A: { S: 'GoTo', D: [pages[1].ref, PDFName.of('Fit')] } }));
  ctx.assign(p3, ctx.obj({ Title: PDFString.of('Page 3'), Parent: partA, Prev: p2, Dest: [pages[2].ref, PDFName.of('Fit')] }));
  ctx.assign(partB, ctx.obj({ Title: PDFString.of('Part B'), Parent: root, Prev: partA, First: six, Last: p5, Count: 2 }));
  ctx.assign(six, ctx.obj({ Title: PDFString.of('Chapter six'), Parent: partB, Next: p5, Dest: PDFString.of('chapter-six') }));
  ctx.assign(p5, ctx.obj({ Title: PDFString.of('Page 5'), Parent: partB, Prev: six, Dest: [pages[4].ref, PDFName.of('Fit')] }));
  ctx.assign(root, ctx.obj({ Type: 'Outlines', First: partA, Last: partB, Count: 2 }));
  doc.catalog.set(PDFName.of('Outlines'), root);
  return doc.save();
}

async function second() {
  const doc = await PDFDocument.create();
  doc.setTitle('Second test document');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = [1, 2].map((n) => {
    const page = doc.addPage([595, 842]); // A4, to tell merged pages apart by size
    lines(page, font, [`SECOND-DOC-PAGE-${n}`, `Page ${n} of the second test document.`]);
    return page;
  });
  pages[0].node.set(PDFName.of('Annots'), doc.context.obj([linkTo(doc, pages[0], [54, 760, 300, 776], pages[1])]));
  const outlines = doc.context.nextRef();
  const item = doc.context.nextRef();
  doc.context.assign(item, doc.context.obj({ Title: PDFString.of('Second start'), Parent: outlines, Dest: [pages[0].ref, PDFName.of('Fit')] }));
  doc.context.assign(outlines, doc.context.obj({ Type: 'Outlines', First: item, Last: item, Count: 1 }));
  doc.catalog.set(PDFName.of('Outlines'), outlines);
  return doc.save();
}

const normalBytes = await normal();
const files = {
  'normal.pdf': normalBytes,
  'large.pdf': await large(),
  'protected.pdf': await protectedFile(),
  'scripted.pdf': await scripted(),
  'links.pdf': await links(),
  'second.pdf': await second(),
  // Cut off halfway through.
  'damaged-truncated.pdf': normalBytes.slice(0, Math.floor(normalBytes.length / 2)),
  // The cross-reference table's position points nowhere.
  'damaged-xref.pdf': Buffer.from(Buffer.from(normalBytes).toString('latin1').replace(/startxref\s+\d+/, 'startxref\n99999999'), 'latin1'),
  // Not a PDF at all.
  'not-a-pdf.pdf': Buffer.from('This is a plain text file with a .pdf name.\n', 'utf8'),
};

for (const [name, bytes] of Object.entries(files)) writeFileSync(path.join(OUT, name), bytes);
console.log(`Test PDFs written to ${OUT}: ${Object.keys(files).join(', ')}`);
