// Finding things to redact by their shape (Phase 2 plan, 2c): email addresses, phone numbers,
// US Social Security numbers and card numbers, plus a list of words or phrases. Matching runs
// over the page's letters as they sit on the page, so each match's boxes cover exactly its
// letters, as Find and mark's do. Plain functions, so the unit tests can check every rule.
import type { Rect } from '../../../engine/types';
import { findTerm, lineBoxes, sameLine, type Glyph } from './glyphs';

export type PatternId = 'email' | 'phone' | 'ssn' | 'card';

export const PATTERNS: { id: PatternId; name: string; plural: string; example: string }[] = [
  { id: 'email', name: 'Email address', plural: 'Email addresses', example: 'name@example.com' },
  { id: 'phone', name: 'Phone number', plural: 'Phone numbers', example: '(555) 123-4567, +44 20 7946 0958' },
  { id: 'ssn', name: 'Social Security number', plural: 'Social Security numbers', example: '123-45-6789' },
  { id: 'card', name: 'Card number', plural: 'Card numbers', example: '13 to 19 digits that pass the card-number check' },
];

/** One match: what was found, and the boxes that cover it (one per line it runs over). */
export interface PatternMatch {
  /** A pattern, or "words" for a word or phrase from the list. */
  pattern: PatternId | 'words';
  /** The words or phrase it matched, for the list. */
  term?: string;
  text: string;
  boxes: Rect[];
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
/** Runs of digits joined by single spaces, dots or dashes, maybe with a +country code or (area code). */
const NUMBER = /(?<![\w@.+-])(?:\+\d{1,3}[ .-]?)?(?:\(\d{2,4}\)[ .-]?)?\d+(?:[ .-]\d+)*(?![\w@]|[.-]\d)/g;

/** The card-number check digit rule (Luhn), which random digits fail nine times in ten. */
export function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return digits.length > 0 && sum % 10 === 0;
}

/** What a run of digits is, if anything: a card number, a Social Security number or a phone number. */
export function classifyNumber(run: string): PatternId | null {
  const digits = run.replace(/\D/g, '');
  const plain = !/[+()]/.test(run);
  // Card: 13 to 19 digits, in groups split by spaces or dashes only, passing the Luhn check.
  if (plain && !run.includes('.') && digits.length >= 13 && digits.length <= 19 && luhn(digits)) return 'card';
  // Social Security number: 3-2-4, with numbers the Social Security Administration never issues left out.
  const ssn = /^(\d{3})([- ])(\d{2})\2(\d{4})$/.exec(run);
  if (ssn) {
    const [, area, , group, serial] = ssn;
    const valid = area !== '000' && area !== '666' && area[0] !== '9' && group !== '00' && serial !== '0000';
    return valid ? 'ssn' : null;
  }
  // Phone: 10 to 15 digits, or a local 555-1234.
  if ((digits.length >= 10 && digits.length <= 15) || /^\d{3}-\d{4}$/.test(run)) return 'phone';
  return null;
}

/** The space between two letters' boxes, along the line. */
function gap(a: Rect, b: Rect): number {
  return Math.max(Math.max(a[0], b[0]) - Math.min(a[2], b[2]), Math.max(a[1], b[1]) - Math.min(a[3], b[3]));
}

/**
 * The page's text as one string, with a space where letters are spread apart (many files don't
 * store spaces) and a line break between lines. `owner` says which letter each character came
 * from (-1 for the spaces and breaks added here).
 */
export function glyphText(glyphs: Glyph[]): { text: string; owner: number[] } {
  let text = '';
  const owner: number[] = [];
  let last: Rect | null = null;
  glyphs.forEach((g, i) => {
    const t = g.text.normalize('NFKC');
    if (!t) return;
    if (last) {
      // The text's size: a letter's box is longest across the line, whichever way the line runs.
      const size = Math.min(Math.max(last[2] - last[0], last[3] - last[1]), Math.max(g.rect[2] - g.rect[0], g.rect[3] - g.rect[1]));
      if (!sameLine(last, g.rect)) {
        text += '\n';
        owner.push(-1);
      } else if (gap(last, g.rect) > size * 0.12 && !/\s$/.test(text) && !/^\s/.test(t)) {
        text += ' ';
        owner.push(-1);
      }
    }
    for (const ch of t) {
      text += ch;
      owner.push(i);
    }
    last = g.rect;
  });
  return { text, owner };
}

/**
 * Everything on a page that matches the chosen patterns or the words list. A stretch of text is
 * only ever one match: email addresses first, then card, Social Security and phone numbers.
 */
export function findPatterns(glyphs: Glyph[], patterns: PatternId[], words: string[]): PatternMatch[] {
  const { text, owner } = glyphText(glyphs);
  const found: (PatternMatch & { start: number; end: number })[] = [];
  const claimed: [number, number][] = [];
  const free = (start: number, end: number) => claimed.every(([s, e]) => end <= s || start >= e);
  const add = (pattern: PatternId, start: number, end: number) => {
    if (!free(start, end)) return;
    const letters = owner.slice(start, end).filter((o) => o >= 0);
    if (letters.length === 0) return;
    const covered = glyphs.slice(Math.min(...letters), Math.max(...letters) + 1);
    claimed.push([start, end]);
    found.push({ pattern, text: text.slice(start, end), boxes: lineBoxes(covered), start, end });
  };
  if (patterns.includes('email')) for (const m of text.matchAll(EMAIL)) add('email', m.index, m.index + m[0].length);
  const numbers = [...text.matchAll(NUMBER)].map((m) => ({ run: m[0], start: m.index, kind: classifyNumber(m[0]) }));
  for (const kind of ['card', 'ssn', 'phone'] as const) {
    if (!patterns.includes(kind)) continue;
    for (const n of numbers) if (n.kind === kind) add(kind, n.start, n.start + n.run.length);
  }
  const matches: PatternMatch[] = found.sort((a, b) => a.start - b.start).map(({ pattern, text: t, boxes }) => ({ pattern, text: t, boxes }));
  for (const word of words) {
    for (const m of findTerm(glyphs, word)) matches.push({ pattern: 'words', term: word, text: m.text, boxes: m.boxes });
  }
  return matches;
}

/** A quick check of a page's text for anything the chosen patterns or words could match. */
export function textMayMatch(text: string, patterns: PatternId[], words: string[]): boolean {
  const squashed = text.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
  if (words.some((w) => squashed.includes(w.normalize('NFKC').toLowerCase().replace(/\s+/g, '')))) return true;
  if (patterns.includes('email') && text.includes('@')) return true;
  // Numbers may be split into pieces in the text list, so any run of digits counts.
  return patterns.some((p) => p !== 'email') && (text.replace(/\D/g, '').length >= 7);
}

/**
 * A hint at what was redacted that doesn't give it away, for the redaction log: "j•••@e•••.com",
 * "(•••) •••-••67", "J••• S•••". Social Security numbers show no digits at all.
 */
export function maskHint(text: string, pattern?: PatternId | 'words'): string {
  const value = text.replace(/\s+/g, ' ').trim();
  if (pattern === 'email' || (!pattern && /@/.test(value))) {
    const [local, domain = ''] = value.split('@');
    const labels = domain.split('.');
    const tld = labels.length > 1 ? `.${labels[labels.length - 1]}` : '';
    return `${local[0] ?? ''}•••@${labels[0]?.[0] ?? ''}•••${tld}`;
  }
  if (pattern === 'ssn') return value.replace(/\d/g, '•');
  if (pattern === 'phone' || pattern === 'card' || (!pattern && /^[\d\s().+-]+$/.test(value))) {
    const digits = value.replace(/\D/g, '').length;
    let seen = 0;
    return value.replace(/\d/g, (d) => (++seen > digits - 2 ? d : '•'));
  }
  return value
    .split(' ')
    .map((word) => (word.length <= 3 ? '•••' : `${word[0]}•••`))
    .join(' ');
}
