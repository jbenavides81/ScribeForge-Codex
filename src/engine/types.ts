// The PDF engine's inputs and outputs. The engine is plain TypeScript (no Electron, no screens),
// so it runs in the app's worker and in the unit tests alike.

export type Rotation = 0 | 90 | 180 | 270;

/** A PDF the engine can take pages from. The bytes are never changed. */
export interface SourceInput {
  id: string;
  /** File name, used for bookmarks when files are merged. */
  name: string;
  bytes: Uint8Array;
  /** Only for password-protected files. Never stored. */
  password?: string;
}

/** One page of the document being built, in order. */
export type PageItem =
  | {
      kind: 'page';
      source: string;
      /** 0-based page index in the source. */
      index: number;
      /** Rotation added on top of the page's own rotation. */
      rotate: Rotation;
    }
  | { kind: 'blank'; width: number; height: number };

/**
 * Four corners in PDF page space, in reading order as the page is shown: upper-left, upper-right,
 * lower-left, lower-right (x, y each). Works on turned pages too.
 */
export type Quad = [number, number, number, number, number, number, number, number];

/** A PDF colour: red, green, blue from 0 to 1. */
export type RGB = [number, number, number];

interface AnnotationCommon {
  /** Unique; saved in the PDF as the annotation's name (scribeforge-…). */
  id: string;
  /** The source page the annotation belongs to. It follows that page wherever it goes. */
  source: string;
  index: number;
  author?: string;
  /** ISO date and time. */
  createdAt: string;
}

/** An annotation added in ScribeForge, saved as a standard PDF annotation. */
export type AnnotationInput =
  | (AnnotationCommon & { kind: 'highlight' | 'underline' | 'strikeout'; quads: Quad[]; colour: RGB; comment?: string })
  | (AnnotationCommon & { kind: 'note'; box: Quad; colour: RGB; comment: string })
  | (AnnotationCommon & {
      kind: 'text';
      /** The box as shown; its height grows to fit the text when saved. */
      box: Quad;
      text: string;
      colour: RGB;
      fontSize: number;
      /** The page's own rotation, so the text is saved upright as shown. */
      rotation: Rotation;
    });

/** What happened to the parts of the pages that point elsewhere. Shown to the person after saving. */
export interface BuildReport {
  pages: number;
  /** Links to other pages, kept and pointed at the right page in the new file. */
  linksKept: number;
  /** Links to pages that aren't in the new file, removed. */
  linksRemoved: number;
  bookmarksKept: number;
  /** Bookmarks to pages that aren't in the new file, removed (their sub-bookmarks stay). */
  bookmarksRemoved: number;
  /** Form fields that keep their look but can no longer be filled in. */
  formFieldsDetached: number;
  /** Scripts and other actions removed (anything but web links, page links and page commands). */
  actionsRemoved: number;
  /** References to pages outside the new file found by the final check and cut. */
  strayReferencesCut: number;
  /** Leftover objects swept out before saving. */
  objectsSwept: number;
  /** Annotations added in ScribeForge and saved with their pages. */
  annotationsAdded: number;
  /** Annotations on pages that aren't in the new file. */
  annotationsLeftOut: number;
  /** Files attached to a whole document (not to a page), which aren't copied into new files. */
  attachmentsLeftOut: number;
}

export function emptyReport(): BuildReport {
  return {
    pages: 0,
    linksKept: 0,
    linksRemoved: 0,
    bookmarksKept: 0,
    bookmarksRemoved: 0,
    formFieldsDetached: 0,
    actionsRemoved: 0,
    strayReferencesCut: 0,
    objectsSwept: 0,
    annotationsAdded: 0,
    annotationsLeftOut: 0,
    attachmentsLeftOut: 0,
  };
}

/** The details a person can edit: kept in two places in a PDF (the classic details and XMP). */
export interface DocInfo {
  title: string;
  author: string;
  subject: string;
  /** As typed, usually separated with commas. */
  keywords: string;
}

export const DOC_INFO_FIELDS = ['title', 'author', 'subject', 'keywords'] as const;

/** How the new file is described. Anything not given comes from the first file its pages come from. */
export interface BuildOptions {
  details?: DocInfo;
  /** Written as the PDF's producer, such as "ScribeForge 0.4.0". */
  producer?: string;
  /** The time written as the new file's last change (for tests). */
  now?: Date;
}

/** One of a file's own details, as stored in the classic details and in XMP. */
export interface Disagreement {
  field: keyof DocInfo;
  info: string;
  xmp: string;
}

/** What the Details screen shows about a file. */
export interface FileDetails {
  /** The classic details (the Info dictionary). Empty when missing. */
  info: DocInfo & { creator: string; producer: string };
  /** ISO dates from the classic details, when they're there and can be read. */
  created?: string;
  modified?: string;
  /** XMP: missing, there but unreadable, or the values read from it. */
  xmp: { state: 'none' } | { state: 'unreadable' } | { state: 'read'; values: Partial<DocInfo> & { producer?: string; creatorTool?: string } };
  /** Details set in both places with different values. */
  disagreements: Disagreement[];
  /** What to show for each editable detail: the classic value, or XMP's when that's empty. */
  shown: DocInfo;
  /** From the file's header, or its catalog when that says a later version. */
  version: string;
  pageCount: number;
  /** Page sizes as shown (turned pages are wide), in points, with how many pages have each. */
  pageSizes: { width: number; height: number; count: number }[];
  /** Locked with a password, or with restrictions set by its author. */
  encrypted: boolean;
}

/** Actions that do more than move around the document. */
export type RiskyAction = 'script' | 'launch' | 'submit' | 'import' | 'other-file';

/** Where a risky action sits. */
export type ActionPlace =
  | { where: 'open' }
  | { where: 'document-event'; event: string }
  | { where: 'document'; name: string }
  | { where: 'bookmark'; title: string }
  | { where: 'page'; page: number; event: 'open' | 'close' }
  | { where: 'link'; page: number }
  | { where: 'field'; name: string; page?: number }
  | { where: 'annotation'; page: number };

/** Everything a file carries besides what's drawn on its pages ("what this file carries"). */
export interface Carries {
  /** The classic details that have values, in order, plus any non-standard ones. */
  details: { key: string; value: string }[];
  xmp: 'none' | 'read' | 'unreadable';
  /** Files attached to the document, or to a page (with its 1-based number). */
  attachments: { name: string; size?: number; page?: number }[];
  formFields: { name: string; filled: boolean }[];
  /** Comments and marks other readers show, counted by kind (PDF subtype), and who wrote them. */
  comments: { total: number; kinds: Record<string, number>; authors: string[] };
  actions: (ActionPlace & { action: RiskyAction })[];
  bookmarks: number;
  layers: { name: string; hidden: boolean }[];
  /** Web and email addresses (each once), and how many links go to pages or to other files. */
  links: { web: string[]; webLinks: number; pages: number; otherFiles: number };
  encrypted: boolean;
}

export interface FileReport {
  details: FileDetails;
  carries: Carries;
}
