// The words for a comparison of two versions (stop 3c): the summary, each page's heading, and
// what changed in its text.
import type { Comparison, PageComparison, TextChanges } from '../../../engine/compare/compare';
import { plural } from '../words';

/** At most this many runs of words are listed for each kind of change on a page. */
const LISTED = 20;

/** "3 pages changed, 1 page added and 2 pages the same.", or that the versions are identical. */
export function compareSummary(c: Comparison): string {
  if (c.identical) return c.same === 1 ? 'The two versions are identical: the page is the same.' : `The two versions are identical: all ${c.same} pages are the same.`;
  const parts = [
    c.changed && `${plural(c.changed, 'page')} changed`,
    c.added && `${plural(c.added, 'page')} added`,
    c.removed && `${plural(c.removed, 'page')} removed`,
    c.same && `${plural(c.same, 'page')} the same`,
  ].filter((p): p is string => !!p);
  return `${parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0]}.`;
}

/** A page's heading: which page it is in each version, and what happened to it. */
export function pageHeading(p: PageComparison, later: number): string {
  const where = p.a === p.b ? `Page ${p.b}` : `Page ${p.a}, now page ${p.b}`;
  switch (p.status) {
    case 'same':
      return `${where}: the same`;
    case 'changed':
      return `${where}: changed`;
    case 'added':
      return `Page ${p.b}: added in version ${later}`;
    case 'removed':
      return `Page ${p.a}: removed in version ${later}`;
  }
}

const quoted = (runs: string[]) => {
  const shown = runs.slice(0, LISTED).map((r) => `“${r}”`);
  return runs.length > LISTED ? `${shown.join(', ')} and ${runs.length - LISTED} more` : shown.join(', ');
};

/** What changed in a page's text, a line for each kind of change. */
export function textChangeLines(text: TextChanges, status: PageComparison['status']): string[] {
  if (status !== 'changed') return [];
  const lines = [
    text.removed.length ? `Words removed: ${quoted(text.removed)}` : '',
    text.added.length ? `Words added: ${quoted(text.added)}` : '',
    text.moved.length ? `Moved on the page: ${quoted(text.moved)}` : '',
  ].filter(Boolean);
  return lines.length ? lines : ['No words changed. Something drawn on the page changed, such as a picture, a line or a colour.'];
}

/** "Reading the pages: 3 of 10…" or "Comparing pages: 2 of 6…". */
export function compareProgress(stage: 'reading' | 'comparing', done: number, total: number): string {
  return stage === 'reading' ? `Reading the pages: ${done} of ${total}…` : `Comparing pages: ${done} of ${total}…`;
}
