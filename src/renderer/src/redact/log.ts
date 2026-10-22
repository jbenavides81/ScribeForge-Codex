// The redaction log (Phase 2 plan, 2c): a plain-text record saved next to a redacted file, when
// the person asks for one. It lists when, which files, the settings, and each mark's page, kind
// and pattern. It never contains the removed text, only a masked hint, because a log that
// repeated the secret would undo the redaction.
import type { BuildReport } from '../../../engine/types';
import { formatDate } from '../details/describe';
import { plural } from '../words';
import { maskHint, PATTERNS } from './patterns';
import { marksByPage, type RedactMark } from './redactState';

export interface LogInput {
  /** When it was redacted (ISO date and time). */
  made: string;
  version: string;
  /** File names: the file the marks were made on, and the redacted file. */
  source: string;
  saved: string;
  report: BuildReport;
  /** The lowest resolution any redacted page was drawn at. */
  dpi: number;
  /** The marks that were applied, and how many were on pages left out of the new file. */
  marks: RedactMark[];
  marksLeftOut: number;
  /** How many marked values the last check searched for, and how many it still found. */
  checked: number;
  found: number;
}

/** What a mark is, for the log: its kind, and a hint that doesn't give its text away. */
export function logLine(mark: RedactMark): string {
  if (mark.kind === 'area') {
    const [x0, y0, x1, y1] = mark.rects.reduce(
      (b, r) => [Math.min(b[0], r[0]), Math.min(b[1], r[1]), Math.max(b[2], r[2]), Math.max(b[3], r[3])],
      [Infinity, Infinity, -Infinity, -Infinity],
    );
    return `Area, ${Math.round(x1 - x0)} × ${Math.round(y1 - y0)} points`;
  }
  const hint = maskHint(mark.text ?? '', mark.pattern);
  if (mark.pattern === 'words') return `Word or phrase from the list: ${hint}`;
  if (mark.pattern) return `${PATTERNS.find((p) => p.id === mark.pattern)?.name ?? 'Pattern'}: ${hint}`;
  if (mark.kind === 'search') return `Find and mark: ${hint}`;
  return `Selected text: ${hint}`;
}

export function redactionLog(input: LogInput): string {
  const { report } = input;
  const left: string[] = ["the document's details (title, author and so on)"];
  if (report.commentsLeftOut > 0) left.push(plural(report.commentsLeftOut, 'comment'));
  if (report.formFieldsLeftOut > 0) left.push(plural(report.formFieldsLeftOut, 'form field'));
  if (report.bookmarksLeftOut > 0) left.push(plural(report.bookmarksLeftOut, 'bookmark'));
  if (report.attachmentsLeftOut > 0) left.push(plural(report.attachmentsLeftOut, 'attached file'));
  if (report.actionsRemoved > 0) left.push(plural(report.actionsRemoved, 'script or action', 'scripts or actions'));

  const lines = [
    'ScribeForge redaction log',
    `Made with ScribeForge ${input.version} on ${formatDate(input.made)}.`,
    '',
    `Redacted file: ${input.saved}`,
    `Made from: ${input.source}`,
    `Pages: ${plural(report.pages, 'page')}, ${plural(report.pagesRedacted, 'page')} redacted. Each redacted page was made into a picture (${input.dpi} dpi) with the marks blacked out, so none of its text is left.`,
    `Left out, as in every redacted file: ${left.join(', ')}.`,
  ];
  if (input.marksLeftOut > 0) lines.push(`${plural(input.marksLeftOut, 'mark')} ${input.marksLeftOut === 1 ? 'was' : 'were'} on pages that aren't in the redacted file.`);
  lines.push(
    input.checked === 0
      ? 'Last check: there were no searched-for words to look for.'
      : input.found === 0
        ? `Last check: the redacted file was searched for ${plural(input.checked, 'marked value')}; none was found.`
        : `Last check: the redacted file was searched for ${plural(input.checked, 'marked value')}; ${input.found} ${input.found === 1 ? 'was' : 'were'} still found, and the file was saved anyway.`,
  );
  lines.push('', `Marks (${input.marks.length}), by page of ${input.source}. Each hint shows a little of what was marked, never the text itself.`);
  for (const [page, list] of marksByPage(input.marks)) {
    lines.push('', `Page ${page + 1}`);
    for (const mark of list) lines.push(`  - ${logLine(mark)}`);
  }
  return `${lines.join('\r\n')}\r\n`;
}
