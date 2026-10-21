// What to tell the person about a new file: what was left out or changed while making it, and
// the message after saving. No screen code, so the unit tests can check every sentence.
import type { BuildReport } from '../../../engine/types';
import { plural } from '../words';

const fileNameOf = (p: string) => p.split(/[\\/]/).pop() ?? p;

/** What ScribeForge left out or changed while making the new file. */
export function buildNotes(report: BuildReport): string[] {
  const lines: string[] = [];
  if (report.annotationsLeftOut > 0) {
    const n = report.annotationsLeftOut;
    lines.push(`${plural(n, 'annotation')} ${n === 1 ? 'was' : 'were'} on pages that aren't in the new file, so ${n === 1 ? 'it was' : 'they were'} left out.`);
  }
  if (report.linksRemoved + report.bookmarksRemoved > 0) {
    lines.push(
      `${plural(report.linksRemoved, 'link')} and ${plural(report.bookmarksRemoved, 'bookmark')} pointed to pages that aren't in the new file, so they were left out.`,
    );
  }
  if (report.formFieldsDetached > 0) lines.push("Form fields look the same but can't be filled in, in the new file.");
  if (report.actionsRemoved > 0) lines.push('Scripts and other actions were removed.');
  if (report.attachmentsLeftOut > 0) {
    const n = report.attachmentsLeftOut;
    lines.push(`${plural(n, 'file')} attached to the whole document ${n === 1 ? "isn't" : "aren't"} copied into the new file.`);
  }
  return lines;
}

/** What to tell the person after saving. */
export function savedMessage(path: string, report: BuildReport): string {
  const lines = [`Saved ${fileNameOf(path)} (${plural(report.pages, 'page')}).`];
  if (report.annotationsAdded > 0) lines.push(`${plural(report.annotationsAdded, 'annotation')} saved with the pages.`);
  return [...lines, ...buildNotes(report)].join('\n');
}

/** What redacting did and what the redacted file leaves out, for the summary before saving. */
export function redactionNotes(report: BuildReport, marks: number, marksLeftOut: number, dpi: number): string[] {
  const lines = [
    `${plural(marks, 'mark')} on ${plural(report.pagesRedacted, 'page')} ${marks === 1 ? 'is' : 'are'} blacked out. ${
      report.pagesRedacted === 1 ? 'That page is now a picture' : 'Those pages are now pictures'
    } (${dpi} dpi): ${report.pagesRedacted === 1 ? 'its' : 'their'} text can't be selected, searched or copied.`,
  ];
  if (marksLeftOut > 0) lines.push(`${plural(marksLeftOut, 'mark')} ${marksLeftOut === 1 ? 'was' : 'were'} on pages that aren't in the new file.`);
  const left: string[] = [];
  if (report.commentsLeftOut > 0) left.push(plural(report.commentsLeftOut, 'comment'));
  if (report.formFieldsLeftOut > 0) left.push(plural(report.formFieldsLeftOut, 'form field'));
  if (report.bookmarksLeftOut > 0) left.push(plural(report.bookmarksLeftOut, 'bookmark'));
  if (report.attachmentsLeftOut > 0) left.push(plural(report.attachmentsLeftOut, 'attached file'));
  if (report.actionsRemoved > 0) left.push(plural(report.actionsRemoved, 'script or action', 'scripts or actions'));
  lines.push(
    `Left out, as in every redacted file: the document's details (title, author and so on)${left.length > 0 ? `, ${left.join(', ')}` : ''}, and any annotations you added.`,
  );
  return lines;
}

/** What to tell the person after saving a redacted file. */
export function redactedMessage(path: string, report: BuildReport): string {
  return `Saved ${fileNameOf(path)} (${plural(report.pages, 'page')}, ${plural(report.pagesRedacted, 'page')} redacted).`;
}
