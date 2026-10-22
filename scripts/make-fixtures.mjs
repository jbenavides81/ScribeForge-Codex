// Generates every test PDF into tests/fixtures/out/. No real documents are ever used.
//   node scripts/make-fixtures.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFString, StandardFonts } from '@cantoo/pdf-lib';

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

// An XMP packet (the second copy of a file's details), written the ways other programs write it:
// some values as elements, some as attributes, over several descriptions.
function xmpPacket({ title, author, subject, keywords, producer, creatorTool }) {
  const esc = (v) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  return [
    '<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>',
    '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
    `<rdf:Description rdf:about="" xmlns:pdf="http://ns.adobe.com/pdf/1.3/" pdf:Producer="${esc(producer)}" pdf:Keywords="${esc(keywords)}"/>`,
    '<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">',
    `<dc:title><rdf:Alt><rdf:li xml:lang="x-default">${esc(title)}</rdf:li></rdf:Alt></dc:title>`,
    `<dc:creator><rdf:Seq><rdf:li>${esc(author)}</rdf:li></rdf:Seq></dc:creator>`,
    `<dc:description><rdf:Alt><rdf:li xml:lang="x-default">${esc(subject)}</rdf:li></rdf:Alt></dc:description>`,
    '</rdf:Description>',
    `<rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmp:CreatorTool="${esc(creatorTool)}"/>`,
    '</rdf:RDF></x:xmpmeta>',
    '<?xpacket end="w"?>',
  ].join('\n');
}

function setXmp(doc, packet) {
  const stream = doc.context.stream(new TextEncoder().encode(packet), { Type: 'Metadata', Subtype: 'XML' });
  doc.catalog.set(PDFName.of('Metadata'), doc.context.register(stream));
}

function embeddedFile(doc, name, text) {
  const bytes = new TextEncoder().encode(text);
  const stream = doc.context.register(
    doc.context.flateStream(bytes, { Type: 'EmbeddedFile', Subtype: 'text/plain', Params: { Size: bytes.length } }),
  );
  return doc.context.register(
    doc.context.obj({ Type: 'Filespec', F: PDFString.of(name), UF: PDFHexString.fromText(name), EF: { F: stream, UF: stream } }),
  );
}

// For the Details screen and "what this file carries" (stop 1d): two page sizes, both copies of
// the details (agreeing), a detail of its own, and one of each thing a file can carry.
async function carries() {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const details = {
    title: 'CARRIES-OLD-TITLE',
    author: 'Fixture Author',
    subject: 'Fixture subject',
    keywords: 'alpha, beta',
    producer: 'Fixture Maker 2.0',
    creatorTool: 'Fixture Writer 1.0',
  };
  doc.setTitle(details.title);
  doc.setAuthor(details.author);
  doc.setSubject(details.subject);
  doc.setKeywords([details.keywords]);
  doc.setCreator(details.creatorTool);
  doc.setProducer(details.producer);
  doc.setCreationDate(new Date('2024-03-05T10:20:30Z'));
  doc.setModificationDate(new Date('2025-06-07T08:09:10Z'));
  doc.context.lookup(doc.context.trailerInfo.Info, PDFDict).set(PDFName.of('Company'), PDFString.of('Fixture Company Ltd'));
  setXmp(doc, xmpPacket(details));

  const page1 = doc.addPage([612, 792]); // US Letter
  const page2 = doc.addPage([842, 595]); // A4, landscape
  lines(page1, font, ['Carries test document', 'CARRIES-PAGE-1', 'Web link: example.com', 'Go to page 2']);
  lines(page2, font, ['CARRIES-PAGE-2', 'Open a program (must never run)'], { top: 540 });

  // Two layers on page 1: one shown, one hidden when the file opens.
  const shown = doc.context.register(doc.context.obj({ Type: 'OCG', Name: PDFString.of('Visible layer') }));
  const hidden = doc.context.register(doc.context.obj({ Type: 'OCG', Name: PDFString.of('Hidden layer') }));
  doc.catalog.set(PDFName.of('OCProperties'), doc.context.obj({ OCGs: [shown, hidden], D: { Order: [shown, hidden], OFF: [hidden] } }));
  const resources = page1.node.Resources();
  resources.set(PDFName.of('Properties'), doc.context.obj({ L1: shown, L2: hidden }));
  resources.lookup(PDFName.of('Font'), PDFDict).set(PDFName.of('FL'), font.ref);
  const layered = doc.context.flateStream(
    '/OC /L1 BDC BT /FL 12 Tf 54 600 Td (VISIBLE-LAYER-TEXT) Tj ET EMC /OC /L2 BDC BT /FL 12 Tf 54 580 Td (HIDDEN-LAYER-TEXT) Tj ET EMC',
  );
  page1.node.addContentStream(doc.context.register(layered));

  // A filled-in text field (customer.name) and an unticked checkbox (agree).
  const form = doc.getForm();
  const field = form.createTextField('customer.name');
  field.setText('FIELD-VALUE');
  field.addToPage(page1, { x: 54, y: 480, width: 200, height: 20, font });
  form.createCheckBox('agree').addToPage(page1, { x: 54, y: 450, width: 14, height: 14 });

  // Comments by two people.
  const note = doc.context.register(
    doc.context.obj({ Type: 'Annot', Subtype: 'Text', Rect: [500, 700, 520, 720], Contents: PDFString.of('A fixture note'), T: PDFString.of('Fixture Author'), Name: 'Note' }),
  );
  const highlight = doc.context.register(
    doc.context.obj({
      Type: 'Annot',
      Subtype: 'Highlight',
      Rect: [54, 718, 160, 734],
      QuadPoints: [54, 734, 160, 734, 54, 718, 160, 718],
      C: [1, 0.9, 0.3],
      T: PDFString.of('Second Reviewer'),
    }),
  );

  // Links: a web address, a page, and a link that would open a program.
  const launch = doc.context.register(
    doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [54, 516, 330, 532], Border: [0, 0, 0], A: { S: 'Launch', F: PDFString.of('calc.exe') } }),
  );
  page1.node.set(
    PDFName.of('Annots'),
    doc.context.obj([...page1.node.Annots().asArray(), note, highlight, uriLink(doc, [54, 686, 230, 702], 'https://example.com/carries'), linkTo(doc, page1, [54, 668, 200, 684], page2)]),
  );

  // A file attached to page 2, and one attached to the whole document.
  const pageFile = doc.context.register(
    doc.context.obj({ Type: 'Annot', Subtype: 'FileAttachment', Rect: [700, 500, 720, 520], FS: embeddedFile(doc, 'page-file.txt', 'PAGE-ATTACHMENT-TEXT'), Name: 'Paperclip' }),
  );
  page2.node.set(PDFName.of('Annots'), doc.context.obj([launch, pageFile]));

  // A document script (never run), and the document attachment.
  const script = doc.context.register(doc.context.obj({ S: 'JavaScript', JS: PDFString.of("app.alert('CARRIES SCRIPT');") }));
  doc.catalog.set(
    PDFName.of('Names'),
    doc.context.obj({
      EmbeddedFiles: { Names: [PDFString.of('notes.txt'), embeddedFile(doc, 'notes.txt', 'ATTACHMENT-SECRET-TEXT')] },
      JavaScript: { Names: [PDFString.of('init'), script] },
    }),
  );

  // Two bookmarks.
  const outlines = doc.context.nextRef();
  const one = doc.context.nextRef();
  const two = doc.context.nextRef();
  doc.context.assign(one, doc.context.obj({ Title: PDFString.of('Chapter one'), Parent: outlines, Next: two, Dest: [page1.ref, PDFName.of('Fit')] }));
  doc.context.assign(two, doc.context.obj({ Title: PDFString.of('Chapter two'), Parent: outlines, Prev: one, Dest: [page2.ref, PDFName.of('Fit')] }));
  doc.context.assign(outlines, doc.context.obj({ Type: 'Outlines', First: one, Last: two, Count: 2 }));
  doc.catalog.set(PDFName.of('Outlines'), outlines);
  return doc.save();
}

// The classic details were changed but the XMP copy wasn't (what pdf-lib's setTitle does).
async function staleXmp() {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  lines(doc.addPage([612, 792]), font, ['Stale XMP test document']);
  doc.setTitle('Current title');
  doc.setAuthor('Fixture Author');
  setXmp(doc, xmpPacket({ title: 'STALE-XMP-TITLE', author: 'Fixture Author', subject: '', keywords: '', producer: 'Fixture Maker 2.0', creatorTool: 'Fixture Writer 1.0' }));
  return doc.save();
}

// An XMP copy that isn't XMP at all.
async function brokenXmp() {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  lines(doc.addPage([612, 792]), font, ['Broken XMP test document']);
  doc.setTitle('Broken XMP test');
  setXmp(doc, '<x:xmpmeta><rdf:RDF><rdf:Description BROKEN-XMP-TEXT');
  return doc.save();
}

// Opens without a password, but its author locked it against copying and changes.
async function ownerLocked() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  lines(doc.addPage([612, 792]), font, ['Owner-locked test document', 'OWNER-LOCKED-PAGE']);
  doc.encrypt({ userPassword: '', ownerPassword: 'owner-only-password', permissions: { copying: false, modifying: false, annotating: false } });
  return doc.save();
}

// For redaction boxes (stop 1e): one word in each way a PDF can place text, each alone on its
// line so a test can check that no part of a letter shows outside its box.
async function textStyles() {
  const doc = await PDFDocument.create();
  const helvetica = await doc.embedFont(StandardFonts.Helvetica);
  const courier = await doc.embedFont(StandardFonts.Courier);
  const times = await doc.embedFont(StandardFonts.TimesRoman);
  const page = doc.addPage([612, 792]);
  const form = doc.context.register(
    doc.context.flateStream('BT /F1 12 Tf 0 0 Td (MIKE) Tj ET', {
      Type: 'XObject',
      Subtype: 'Form',
      BBox: [0, -10, 100, 30],
      Matrix: [1, 0, 0, 1, 300, 0],
      Resources: { Font: { F1: helvetica.ref } },
    }),
  );
  page.node.set(PDFName.of('Resources'), doc.context.obj({ Font: { F1: helvetica.ref, F2: courier.ref, F3: times.ref }, XObject: { Fm1: form } }));
  const content = [
    'BT /F1 14 Tf 72 720 Td (ALPHA) Tj ET', // plain
    'q BT /F1 14 Tf 2 Tc 72 680 Td (BRAVO) Tj ET Q', // character spacing
    'q BT /F1 14 Tf 70 Tz 72 640 Td (CHARLIE) Tj ET Q', // squeezed to 70% width
    'q BT /F1 14 Tf 4 Ts 72 600 Td (DELTA) Tj ET Q', // raised
    'BT /F1 14 Tf 72 560 Td [(EC) -120 (HO)] TJ ET', // kerned
    'q 1.5 0 0 1.5 72 500 cm BT /F1 10 Tf 0 0 Td (FOXTROT) Tj ET Q', // scaled page space
    'BT /F1 14 Tf 0 1 -1 0 520 300 Tm (GOLF) Tj ET', // turned to run upwards
    'q BT /F1 14 Tf 12 Tw 72 440 Td (HOTEL INDIA) Tj ET Q', // wide word spacing
    'BT /F2 14 Tf 72 400 Td (JULIET) Tj ET', // fixed-width font
    "BT /F1 14 Tf 20 TL 72 380 Td (KILO) ' ET", // next line, then show
    'q BT /F1 14 Tf 20 TL 72 340 Td 3 1 (LIMA) " ET Q', // set spacing, next line, show
    'q 1 0 0 1 0 220 cm /Fm1 Do Q', // inside a form with its own position
    'BT /F3 16 Tf 300 720 Td (NOVEMBER) Tj ET', // another font
  ].join('\n');
  page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.flateStream(content)));
  return doc.save();
}

// For redaction (stop 1e): a test term placed in page text (plain, kerned, invisible and on a
// hidden layer), a comment, the title, the XMP copy, a bookmark, an attachment's name and its
// contents, a script, and in hidden data on a page that isn't marked.
// For stop 2c's pattern search: made-up examples of each pattern, and look-alikes that must not
// match. The card numbers are the card companies' published test numbers.
export const PATTERN_EXAMPLES = {
  email: ['jane.doe@example.com', 'j.smith+work@mail.example.org'],
  phone: ['(555) 123-4567', '555.987.6543', '+1 555 246 8135', '+44 20 7946 0958'],
  ssn: ['123-45-6789', '234 56 7890'],
  card: ['4111 1111 1111 1111', '5500-0000-0000-0004', '378282246310005'],
  words: ['Project Nightingale'],
};
export const PATTERN_LOOKALIKES = ['user@localhost', '2026-10-21', '12345-6789', '000-12-3456', '666-12-3456', '123-00-4567', '4111 1111 1111 1112', '1234567890123456'];

async function patterns() {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.setTitle('Pattern test document');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const e = PATTERN_EXAMPLES;
  lines(doc.addPage([612, 792]), font, [
    'PATTERNS-PAGE-1',
    `Write to ${e.email[0]} or ${e.email[1]} for help.`,
    `Call ${e.phone[0]} or ${e.phone[1]} during the day.`,
    `Abroad: ${e.phone[2]} or ${e.phone[3]}.`,
    `SSN on file: ${e.ssn[0]}, spouse ${e.ssn[1]}.`,
    'Look-alikes that are not matches:',
    'user@localhost, dated 2026-10-21, ZIP 12345-6789, ref 000-12-3456,',
    'ref 666-12-3456, ref 123-00-4567, item 1234567890123456.',
  ]);
  lines(doc.addPage([612, 792]), font, [
    'PATTERNS-PAGE-2',
    `Paid with ${e.card[0]} and ${e.card[1]}.`,
    `Corporate card ${e.card[2]}.`,
    'Not a card: 4111 1111 1111 1112.',
    `The code name is ${e.words[0]}, kept quiet.`,
  ]);
  return doc.save();
}

export const REDACT_TERM = 'REDACT-ME-TERM';
async function redaction() {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.setTitle(`Report on ${REDACT_TERM}`);
  doc.setAuthor('Fixture Author');
  setXmp(doc, xmpPacket({ title: `Report on ${REDACT_TERM}`, author: 'Fixture Author', subject: '', keywords: '', producer: 'Fixture Maker 2.0', creatorTool: 'Fixture Writer 1.0' }));
  const [p1, p2, p3] = [1, 2, 3].map(() => doc.addPage([612, 792]));

  // Page 1 is never marked: its text must come through unchanged.
  lines(p1, font, ['UNMARKED-PAGE-ONE', 'Nothing secret is written on this page.', 'Go to page 3']);
  const comment = doc.context.register(
    doc.context.obj({ Type: 'Annot', Subtype: 'Text', Rect: [500, 700, 520, 720], Contents: PDFString.of(`A comment about ${REDACT_TERM}`), T: PDFString.of('Fixture Author') }),
  );
  p1.node.set(PDFName.of('Annots'), doc.context.obj([comment, linkTo(doc, p1, [54, 700, 200, 716], p3)]));
  p1.node.set(PDFName.of('PieceInfo'), doc.context.obj({ FixtureApp: { Private: PDFString.of(REDACT_TERM) } }));
  const pageXmp = doc.context.stream(new TextEncoder().encode(`<x:xmpmeta xmlns:x="adobe:ns:meta/"><!-- ${REDACT_TERM} --></x:xmpmeta>`), { Type: 'Metadata', Subtype: 'XML' });
  p1.node.set(PDFName.of('Metadata'), doc.context.register(pageXmp));

  // Page 2: the term in a sentence.
  lines(p2, font, ['MARKED-PAGE-TWO', `The secret is ${REDACT_TERM} in this sentence.`, 'The rest of this line stays.']);

  // Page 3: the term kerned, invisible (like scanned text), and on a hidden layer.
  lines(p3, font, ['MARKED-PAGE-THREE']);
  const hidden = doc.context.register(doc.context.obj({ Type: 'OCG', Name: PDFString.of('Draft notes') }));
  doc.catalog.set(PDFName.of('OCProperties'), doc.context.obj({ OCGs: [hidden], D: { OFF: [hidden] } }));
  const resources = p3.node.Resources();
  resources.set(PDFName.of('Properties'), doc.context.obj({ L1: hidden }));
  resources.lookup(PDFName.of('Font'), PDFDict).set(PDFName.of('FR'), font.ref);
  const extra = [
    'BT /FR 12 Tf 54 700 Td [(REDACT-) -10 (ME-TERM)] TJ ET',
    'BT 3 Tr /FR 12 Tf 54 660 Td (REDACT-ME-TERM) Tj ET',
    '/OC /L1 BDC BT /FR 12 Tf 54 620 Td (REDACT-ME-TERM) Tj ET EMC',
  ].join('\n');
  p3.node.addContentStream(doc.context.register(doc.context.flateStream(extra)));

  // A bookmark, an attachment, and a script, all naming the term.
  const outlines = doc.context.nextRef();
  const item = doc.context.nextRef();
  doc.context.assign(item, doc.context.obj({ Title: PDFString.of(`Chapter about ${REDACT_TERM}`), Parent: outlines, Dest: [p2.ref, PDFName.of('Fit')] }));
  doc.context.assign(outlines, doc.context.obj({ Type: 'Outlines', First: item, Last: item, Count: 1 }));
  doc.catalog.set(PDFName.of('Outlines'), outlines);
  const script = doc.context.register(doc.context.obj({ S: 'JavaScript', JS: PDFString.of(`app.alert('${REDACT_TERM}');`) }));
  doc.catalog.set(
    PDFName.of('Names'),
    doc.context.obj({
      EmbeddedFiles: { Names: [PDFString.of(`${REDACT_TERM}.txt`), embeddedFile(doc, `${REDACT_TERM}.txt`, `Attached ${REDACT_TERM}`)] },
      JavaScript: { Names: [PDFString.of('init'), script] },
    }),
  );
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
  'carries.pdf': await carries(),
  'stale-xmp.pdf': await staleXmp(),
  'broken-xmp.pdf': await brokenXmp(),
  'owner-locked.pdf': await ownerLocked(),
  'text-styles.pdf': await textStyles(),
  'redaction.pdf': await redaction(),
  'patterns.pdf': await patterns(),
  // Cut off halfway through.
  'damaged-truncated.pdf': normalBytes.slice(0, Math.floor(normalBytes.length / 2)),
  // The cross-reference table's position points nowhere.
  'damaged-xref.pdf': Buffer.from(Buffer.from(normalBytes).toString('latin1').replace(/startxref\s+\d+/, 'startxref\n99999999'), 'latin1'),
  // Not a PDF at all.
  'not-a-pdf.pdf': Buffer.from('This is a plain text file with a .pdf name.\n', 'utf8'),
};

for (const [name, bytes] of Object.entries(files)) writeFileSync(path.join(OUT, name), bytes);
console.log(`Test PDFs written to ${OUT}: ${Object.keys(files).join(', ')}`);
