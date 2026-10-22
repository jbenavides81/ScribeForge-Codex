// Stop 2c: the redaction log lists when, which files, the settings and each mark's page, kind and
// pattern, and never contains the removed text: a test searches it for every redacted value.
import path from 'node:path';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import { emptyReport } from '../../src/engine/types';
import { pageGlyphs } from '../../src/renderer/src/redact/glyphs';
import { logLine, redactionLog } from '../../src/renderer/src/redact/log';
import { findPatterns } from '../../src/renderer/src/redact/patterns';
import type { RedactMark } from '../../src/renderer/src/redact/redactState';
import { fixture, ROOT } from './support/inspect';

const FONTS = `${path.join(ROOT, 'node_modules/pdfjs-dist/standard_fonts').replace(/\\/g, '/')}/`;
const API = { OPS: pdfjs.OPS as unknown as Record<string, number>, annotationsOff: pdfjs.AnnotationMode.DISABLE };

/** Marks made from every pattern match in patterns.pdf, as Find patterns makes them. */
async function patternMarks(): Promise<RedactMark[]> {
  const doc = await pdfjs.getDocument({ data: fixture('patterns.pdf'), standardFontDataUrl: FONTS, useWorkerFetch: false, verbosity: 0 }).promise;
  const marks: RedactMark[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const found = findPatterns(await pageGlyphs(await doc.getPage(n), API), ['email', 'phone', 'ssn', 'card'], ['Project Nightingale']);
    found.forEach((m, i) => marks.push({ id: `${n}-${i}`, page: n - 1, kind: 'search', rects: m.boxes, text: m.text, term: m.term ?? m.text, pattern: m.pattern }));
  }
  await doc.loadingTask.destroy();
  return marks;
}

describe('the redaction log', () => {
  it('lists when, the files, the settings and each mark, and none of the marked text', async () => {
    const marks: RedactMark[] = [
      ...(await patternMarks()),
      { id: 'a', page: 0, kind: 'area', rects: [[72, 600, 192, 640]] },
      { id: 't', page: 1, kind: 'text', rects: [[0, 0, 1, 1]], text: 'Confidential Supplier Name' },
      { id: 's', page: 1, kind: 'search', rects: [[0, 0, 1, 1]], text: 'REDACT-ME-TERM', term: 'REDACT-ME-TERM' },
    ];
    const report = { ...emptyReport(), pages: 2, pagesRedacted: 2, commentsLeftOut: 1 };
    const log = redactionLog({
      made: '2026-10-21T15:00:00.000Z',
      version: '1.3.0',
      source: 'patterns.pdf',
      saved: 'patterns (redacted).pdf',
      report,
      dpi: 200,
      marks,
      marksLeftOut: 1,
      checked: 12,
      found: 0,
    });
    expect(log).toContain('ScribeForge redaction log');
    expect(log).toContain('Made with ScribeForge 1.3.0 on ');
    expect(log).toContain('Redacted file: patterns (redacted).pdf');
    expect(log).toContain('Made from: patterns.pdf');
    expect(log).toContain('2 pages, 2 pages redacted');
    expect(log).toContain('(200 dpi)');
    expect(log).toContain('1 comment');
    expect(log).toContain("1 mark was on pages that aren't in the redacted file");
    expect(log).toContain('searched for 12 marked values; none was found');
    expect(log).toContain('Page 1\r\n');
    expect(log).toContain('  - Email address: j•••@e•••.com');
    expect(log).toContain('  - Phone number: (•••) •••-••67');
    expect(log).toContain('  - Social Security number: •••-••-••••');
    expect(log).toContain('  - Card number: •••• •••• •••• ••11');
    expect(log).toContain('  - Word or phrase from the list: P••• N•••');
    expect(log).toContain('  - Area, 120 × 40 points');
    expect(log).toContain('  - Selected text: C••• S••• N•••');
    // The required check: no redacted value appears anywhere in the log, in any spacing.
    const squashed = log.replace(/\s+/g, '');
    for (const m of marks) {
      if (!m.text) continue;
      expect(log.includes(m.text), m.text).toBe(false);
      expect(squashed.includes(m.text.replace(/\s+/g, '')), m.text).toBe(false);
      for (const word of m.text.split(/\s+/).filter((w) => w.length > 3)) expect(log.includes(word), word).toBe(false);
    }
  });

  it('says when the last check still found something', () => {
    const log = redactionLog({
      made: '2026-10-21T15:00:00.000Z',
      version: '1.3.0',
      source: 'a.pdf',
      saved: 'a (redacted).pdf',
      report: { ...emptyReport(), pages: 1, pagesRedacted: 1 },
      dpi: 150,
      marks: [{ id: 'a', page: 0, kind: 'area', rects: [[0, 0, 10, 10]] }],
      marksLeftOut: 0,
      checked: 2,
      found: 1,
    });
    expect(log).toContain('1 was still found, and the file was saved anyway');
    expect(logLine({ id: 'x', page: 0, kind: 'search', rects: [], text: 'Smith', term: 'Smith' })).toBe('Find and mark: S•••');
  });
});
