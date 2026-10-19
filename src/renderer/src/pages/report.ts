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
