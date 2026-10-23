// What to tell the person about a new file: what was left out or changed while making it, and
// the message after saving. No screen code, so the unit tests can check every sentence.
import type { BuildReport, RedactKeep } from '../../../engine/types';
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
  if (report.annotationsNotFlattened > 0) {
    const n = report.annotationsNotFlattened;
    lines.push(`${plural(n, 'annotation')} couldn't be burned into the page, because ${n === 1 ? 'it has' : 'they have'} no look of ${n === 1 ? 'its' : 'their'} own; ${n === 1 ? "it's" : "they're"} kept as ${n === 1 ? 'an annotation' : 'annotations'}.`);
  }
  if (report.signaturesLeftOut > 0) {
    const n = report.signaturesLeftOut;
    lines.push(`${plural(n, 'signature')} ${n === 1 ? 'was' : 'were'} left out, with ${n === 1 ? 'its box' : 'their boxes'}: a signature only holds for the exact file that was signed.`);
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
  if (report.annotationsChanged > 0) lines.push(`${plural(report.annotationsChanged, 'annotation')} already in the file ${report.annotationsChanged === 1 ? 'was' : 'were'} changed.`);
  if (report.annotationsDeleted > 0) lines.push(`${plural(report.annotationsDeleted, 'annotation')} ${report.annotationsDeleted === 1 ? 'was' : 'were'} deleted.`);
  if (report.annotationsFlattened > 0) lines.push(`${plural(report.annotationsFlattened, 'annotation')} ${report.annotationsFlattened === 1 ? 'was' : 'were'} burned into the pages.`);
  return [...lines, ...buildNotes(report)].join('\n');
}

/** What redacting did and what the redacted file leaves out, for the summary before saving. */
export function redactionNotes(report: BuildReport, marks: number, marksLeftOut: number, dpi: number, kept: RedactKeep = {}): string[] {
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
  lines.push(`${redactionLeftOut(left, kept)}.`);
  const keptNames = keptList(kept);
  if (keptNames.length > 0) lines.push(`Kept, as you chose: ${keptNames.join(', ')}.`);
  return lines;
}

/** What a redacted file keeps by choice, in a few words each. */
export function keptList(kept: RedactKeep): string[] {
  return [
    kept.details ? "the document's details" : '',
    kept.bookmarks ? 'bookmarks' : '',
    kept.comments ? 'comments on pages without marks' : '',
    kept.formFields ? 'form fields on pages without marks' : '',
    kept.attachments ? 'files attached to pages without marks' : '',
  ].filter(Boolean);
}

/** "Left out, as in every redacted file: …", listing what was left out (but not what was kept). */
export function redactionLeftOut(left: string[], kept: RedactKeep = {}): string {
  const items = [...(kept.details ? [] : ["the document's details (title, author and so on)"]), ...left, 'any annotations you added'];
  const head = keptList(kept).length > 0 ? 'Left out' : 'Left out, as in every redacted file';
  return `${head}: ${items.length > 1 ? `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}` : items[0]}`;
}

/** What clean-up took out of the new file, for the summary before saving and the message after. */
export function cleanNotes(report: BuildReport): string[] {
  const removed: string[] = [];
  if (report.detailsRemoved > 0) removed.push("the document's details");
  if (report.attachmentsRemoved > 0) removed.push(`${plural(report.attachmentsRemoved, 'file')} attached to pages`);
  if (report.formFieldsRemoved > 0) removed.push(plural(report.formFieldsRemoved, 'form field'));
  if (report.commentsRemoved > 0) removed.push(plural(report.commentsRemoved, 'comment'));
  if (report.layersRemoved > 0) removed.push(`${plural(report.layersRemoved, 'hidden layer')} and what was on ${report.layersRemoved === 1 ? 'it' : 'them'}`);
  if (report.bookmarksCleared > 0) removed.push(plural(report.bookmarksCleared, 'bookmark'));
  if (report.pageDataRemoved > 0) removed.push(`hidden page data from ${plural(report.pageDataRemoved, 'page')}`);
  const lines: string[] = [];
  if (removed.length > 0) lines.push(`Removed: ${removed.join('; ')}.`);
  if (report.formFieldsFlattened > 0) {
    const n = report.formFieldsFlattened;
    lines.push(`${plural(n, 'form field')} ${n === 1 ? 'was' : 'were'} burned into the page: ${n === 1 ? 'it looks' : 'they look'} the same, but ${n === 1 ? "it's" : "they're"} no longer a field, and the data is gone.`);
  }
  if (report.annotationsFlattened > 0) {
    const n = report.annotationsFlattened;
    lines.push(`${plural(n, 'comment')} ${n === 1 ? 'was' : 'were'} burned into the page: ${n === 1 ? 'it looks' : 'they look'} the same, but ${n === 1 ? 'its' : 'their'} text and replies are gone.`);
  }
  if (report.hiddenContentKept > 0) {
    lines.push(
      `On ${plural(report.hiddenContentKept, 'page')}, what's on hidden layers was left in place, still hidden: taking it out would have moved the text that shows.`,
    );
  }
  return lines;
}

/** What to tell the person after saving a cleaned file. */
export function cleanedMessage(path: string, report: BuildReport): string {
  return [`Saved ${fileNameOf(path)} (${plural(report.pages, 'page')}).`, ...cleanNotes(report)].join('\n');
}

/** What to tell the person after saving a redacted file. */
export function redactedMessage(path: string, report: BuildReport): string {
  return `Saved ${fileNameOf(path)} (${plural(report.pages, 'page')}, ${plural(report.pagesRedacted, 'page')} redacted).`;
}
