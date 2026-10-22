// "scribeforge info": a file's details and what it carries, as plain text.
import type { FileReport } from '../../engine/types';
import { actionText, commentKinds, DETAIL_LABELS, detailValue, formatDate, pageSize, sizeText } from '../../renderer/src/details/describe';
import { plural } from '../../renderer/src/words';

export function infoText(name: string, report: FileReport): string[] {
  const { details, carries: c } = report;
  const lines = [name, ''];
  lines.push('Details');
  const shown = [
    ['Title', details.shown.title],
    ['Author', details.shown.author],
    ['Subject', details.shown.subject],
    ['Keywords', details.shown.keywords],
  ].filter(([, v]) => v);
  if (shown.length === 0) lines.push('  None');
  for (const [k, v] of shown) lines.push(`  ${k}: ${v}`);
  for (const d of details.disagreements) lines.push(`  Note: the two copies of the details disagree on the ${d.field}: "${d.info}" and "${d.xmp}" (XMP).`);
  if (details.xmp.state === 'unreadable') lines.push("  Note: the XMP copy of the details can't be read.");

  lines.push('', 'About this file');
  lines.push(`  Made with: ${details.info.creator || 'not recorded'}`);
  lines.push(`  PDF made by: ${details.info.producer || 'not recorded'}`);
  lines.push(`  Created: ${formatDate(details.created) || 'not recorded'}`);
  lines.push(`  Last changed: ${formatDate(details.modified) || 'not recorded'}`);
  lines.push(`  PDF version: ${details.version || 'unknown'}`);
  lines.push(`  Pages: ${plural(details.pageCount, 'page')}`);
  for (const s of details.pageSizes) lines.push(`    ${plural(s.count, 'page')}: ${pageSize(s.width, s.height)}`);
  lines.push(`  Password or restrictions: ${details.encrypted ? 'yes' : 'no'}`);

  const filled = c.formFields.filter((f) => f.filled).length;
  const hidden = c.layers.filter((l) => l.hidden).length;
  lines.push('', 'What it carries');
  lines.push(`  Details: ${c.details.length > 0 ? plural(c.details.length, 'detail') : 'none'}`);
  for (const d of c.details) lines.push(`    ${DETAIL_LABELS[d.key] ?? d.key}: ${detailValue(d.key, d.value)}`);
  if (c.xmp === 'read') lines.push('    (a second copy is kept in XMP format)');
  lines.push(`  Attached files: ${c.attachments.length > 0 ? plural(c.attachments.length, 'file') : 'none'}`);
  for (const a of c.attachments) lines.push(`    ${[a.name, a.size !== undefined ? sizeText(a.size) : '', a.page ? `on page ${a.page}` : 'attached to the whole file'].filter(Boolean).join(', ')}`);
  lines.push(`  Form fields: ${c.formFields.length > 0 ? `${plural(c.formFields.length, 'field')}, ${filled} filled in` : 'none'}`);
  lines.push(`  Comments: ${c.comments.total > 0 ? commentKinds(c.comments.kinds) : 'none'}`);
  if (c.comments.authors.length > 0) lines.push(`    by ${c.comments.authors.join(', ')}`);
  lines.push(`  Scripts and actions: ${c.actions.length > 0 ? plural(c.actions.length, 'script or action', 'scripts or actions') : 'none'}`);
  for (const a of c.actions) lines.push(`    ${actionText(a)}`);
  lines.push(`  Bookmarks: ${c.bookmarks > 0 ? plural(c.bookmarks, 'bookmark') : 'none'}`);
  lines.push(`  Layers: ${c.layers.length > 0 ? `${plural(c.layers.length, 'layer')}, ${hidden} hidden` : 'none'}`);
  for (const l of c.layers) lines.push(`    ${l.name || 'unnamed layer'}${l.hidden ? ' (hidden)' : ''}`);
  const links = [
    c.links.webLinks > 0 ? plural(c.links.webLinks, 'web or email link') : '',
    c.links.pages > 0 ? plural(c.links.pages, 'link to a page', 'links to pages') : '',
    c.links.otherFiles > 0 ? plural(c.links.otherFiles, 'link to another file', 'links to other files') : '',
  ].filter(Boolean);
  lines.push(`  Hidden page data: ${c.pageData > 0 ? `on ${plural(c.pageData, 'page')}` : 'none'}`);
  lines.push(`  Links: ${links.length > 0 ? links.join(', ') : 'none'}`);
  for (const w of c.links.web) lines.push(`    ${w}`);
  return lines;
}
