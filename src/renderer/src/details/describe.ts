// Plain words for a file's details and what it carries. No screen code, so the unit tests can
// check every sentence.
import type { ActionPlace, Carries, RiskyAction } from '../../../engine/types';
import { plural } from '../words';


/** Labels for the classic details, by their PDF key. Other keys are shown as they are. */
export const DETAIL_LABELS: Record<string, string> = {
  Title: 'Title',
  Author: 'Author',
  Subject: 'Subject',
  Keywords: 'Keywords',
  Creator: 'Made with',
  Producer: 'PDF made by',
  CreationDate: 'Created',
  ModDate: 'Last changed',
};

export function formatDate(iso: string | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'short' });
}

export function detailValue(key: string, value: string): string {
  return key === 'CreationDate' || key === 'ModDate' ? formatDate(value) : value;
}

const PAPER: { name: string; w: number; h: number }[] = [
  { name: 'Letter', w: 612, h: 792 },
  { name: 'Legal', w: 612, h: 1008 },
  { name: 'Tabloid', w: 792, h: 1224 },
  { name: 'A3', w: 842, h: 1191 },
  { name: 'A4', w: 595, h: 842 },
  { name: 'A5', w: 420, h: 595 },
];

const inches = (points: number) => String(Math.round((points / 72) * 100) / 100);

/** "8.5 × 11 in (Letter)", "11.69 × 8.27 in (A4, sideways)", or just the size. */
export function pageSize(width: number, height: number): string {
  const near = (a: number, b: number) => Math.abs(a - b) <= 2;
  const upright = PAPER.find((p) => near(p.w, width) && near(p.h, height));
  const sideways = PAPER.find((p) => near(p.h, width) && near(p.w, height));
  const size = `${inches(width)} × ${inches(height)} in`;
  if (upright) return `${size} (${upright.name})`;
  if (sideways) return `${size} (${sideways.name}, sideways)`;
  return size;
}

const COMMENT_KINDS: Record<string, [string, string]> = {
  Text: ['note', 'notes'],
  FreeText: ['text box', 'text boxes'],
  Highlight: ['highlight', 'highlights'],
  Underline: ['underline', 'underlines'],
  StrikeOut: ['strikeout', 'strikeouts'],
  Squiggly: ['squiggly underline', 'squiggly underlines'],
  Ink: ['drawing', 'drawings'],
  Square: ['shape', 'shapes'],
  Circle: ['shape', 'shapes'],
  Line: ['shape', 'shapes'],
  Polygon: ['shape', 'shapes'],
  PolyLine: ['shape', 'shapes'],
  Stamp: ['stamp', 'stamps'],
  Caret: ['insert mark', 'insert marks'],
  Redact: ['redaction mark, not applied', 'redaction marks, not applied'],
};

/** "2 notes, 1 highlight and 3 shapes". */
export function commentKinds(kinds: Record<string, number>): string {
  const counts = new Map<string, { n: number; forms: [string, string] }>();
  for (const [kind, n] of Object.entries(kinds)) {
    const forms = COMMENT_KINDS[kind] ?? ['other mark', 'other marks'];
    const entry = counts.get(forms[0]) ?? { n: 0, forms };
    entry.n += n;
    counts.set(forms[0], entry);
  }
  const parts = [...counts.values()].map(({ n, forms }) => plural(n, forms[0], forms[1]));
  return parts.length <= 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}

const ACTION_NAMES: Record<RiskyAction, string> = {
  script: 'Script',
  launch: 'Opens a program or file',
  submit: 'Sends form data',
  import: 'Loads data from a file',
  'other-file': 'Opens another file',
};

const DOCUMENT_EVENTS: Record<string, string> = {
  WC: 'before the file closes',
  WS: 'before the file is saved',
  DS: 'after the file is saved',
  WP: 'before printing',
  DP: 'after printing',
};

function placeText(place: ActionPlace): string {
  switch (place.where) {
    case 'open':
      return 'when the file opens';
    case 'document-event':
      return DOCUMENT_EVENTS[place.event] ?? 'when something happens to the file';
    case 'document':
      return place.name ? `document script "${place.name}"` : 'document script';
    case 'bookmark':
      return `bookmark "${place.title}"`;
    case 'page':
      return `when page ${place.page} ${place.event === 'close' ? 'closes' : 'opens'}`;
    case 'link':
      return `link on page ${place.page}`;
    case 'field':
      return `form field "${place.name}"${place.page ? ` on page ${place.page}` : ''}`;
    case 'annotation':
      return `comment on page ${place.page}`;
  }
}

/** "Script: when the file opens". */
export function actionText(a: ActionPlace & { action: RiskyAction }): string {
  return `${ACTION_NAMES[a.action]}: ${placeText(a)}`;
}

/** pdf.js permission flags, and what each one allows. */
const PERMISSIONS: [number, string][] = [
  [4, 'printing'],
  [2048, 'high-quality printing'],
  [16, 'copying text and images'],
  [8, 'changing the document'],
  [32, 'adding or changing comments'],
  [256, 'filling in forms'],
  [1024, 'inserting, deleting or turning pages'],
];

/** What a locked file's author doesn't allow, from pdf.js's list of what is allowed. */
export function restrictions(allowed: number[] | null | undefined): string[] {
  if (!allowed) return [];
  return PERMISSIONS.filter(([flag]) => !allowed.includes(flag)).map(([, text]) => text);
}

export function sizeText(bytes: number | undefined): string {
  if (bytes === undefined) return '';
  if (bytes < 1024) return plural(bytes, 'byte');
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${Math.round((bytes / 1024 / 1024) * 10) / 10} MB`;
}

/** "2 signatures", "1 signature and 1 empty signature box", or "None". */
export function signaturesText(list: { signed: boolean }[]): string {
  const signed = list.filter((s) => s.signed).length;
  const empty = list.length - signed;
  const parts = [signed > 0 ? plural(signed, 'signature') : '', empty > 0 ? plural(empty, 'empty signature box', 'empty signature boxes') : ''].filter(Boolean);
  return parts.length > 0 ? parts.join(' and ') : 'None';
}

/** What several new files carry, together (for split). */
export function combineCarries(list: Carries[]): Carries {
  const [first] = list;
  const kinds: Record<string, number> = {};
  for (const c of list) for (const [k, n] of Object.entries(c.comments.kinds)) kinds[k] = (kinds[k] ?? 0) + n;
  const layers = new Map<string, boolean>();
  for (const c of list) for (const l of c.layers) layers.set(l.name, (layers.get(l.name) ?? false) || l.hidden);
  return {
    details: first?.details ?? [],
    xmp: first?.xmp ?? 'none',
    attachments: list.flatMap((c) => c.attachments),
    formFields: list.flatMap((c) => c.formFields),
    signatures: list.flatMap((c) => c.signatures),
    comments: {
      total: list.reduce((n, c) => n + c.comments.total, 0),
      kinds,
      authors: [...new Set(list.flatMap((c) => c.comments.authors))].sort((a, b) => a.localeCompare(b)),
    },
    actions: list.flatMap((c) => c.actions),
    pageData: list.reduce((n, c) => n + c.pageData, 0),
    bookmarks: list.reduce((n, c) => n + c.bookmarks, 0),
    layers: [...layers].map(([name, hidden]) => ({ name, hidden })),
    links: {
      web: [...new Set(list.flatMap((c) => c.links.web))],
      webLinks: list.reduce((n, c) => n + c.links.webLinks, 0),
      pages: list.reduce((n, c) => n + c.links.pages, 0),
      otherFiles: list.reduce((n, c) => n + c.links.otherFiles, 0),
    },
    encrypted: list.some((c) => c.encrypted),
  };
}
