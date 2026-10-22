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

/** A point in PDF page space. */
export type Pt = [number, number];

interface AnnotationCommon {
  /** Unique; saved in the PDF as the annotation's name (scribeforge-…). */
  id: string;
  /** The source page the annotation belongs to. It follows that page wherever it goes. */
  source: string;
  index: number;
  author?: string;
  /** ISO date and time. */
  createdAt: string;
  /**
   * Burned into the page when saving (Phase 2 plan, F5): it keeps its look but is no longer an
   * annotation, so it can't be changed or removed.
   */
  flatten?: boolean;
}

/** The stamps ScribeForge offers. Custom has the person's own text. */
export type StampKind = 'approved' | 'draft' | 'confidential' | 'reviewed' | 'not-approved' | 'custom';

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
    })
  /** Freehand drawing: one or more strokes, each a list of points. */
  | (AnnotationCommon & { kind: 'ink'; paths: Pt[][]; colour: RGB; width: number; comment?: string })
  /** Rectangle or ellipse filling the box, with an optional fill colour. */
  | (AnnotationCommon & { kind: 'rect' | 'ellipse'; box: Quad; colour: RGB; fill?: RGB; width: number; comment?: string })
  /** A straight line; an arrow has its head at `to`. */
  | (AnnotationCommon & { kind: 'line' | 'arrow'; from: Pt; to: Pt; colour: RGB; width: number; comment?: string })
  | (AnnotationCommon & {
      kind: 'stamp';
      stamp: StampKind;
      /** What the stamp says, such as "Approved", and the date under it. */
      label: string;
      date: string;
      box: Quad;
      colour: RGB;
      rotation: Rotation;
      comment?: string;
    })
  /**
   * A reply to another annotation: one added in ScribeForge (its id) or one already in the file
   * ("file:" and pdf.js's id for it, such as "file:12R"). Saved as a comment that points to it.
   */
  | (AnnotationCommon & { kind: 'reply'; replyTo: string; comment: string });

/**
 * A change to an annotation that was already in a source file, found by pdf.js's id for it
 * (its object number, such as "12R"). Whatever isn't changed (author, dates, other replies)
 * stays as it was.
 */
export interface FileAnnotationChange {
  source: string;
  /** The page it's on. */
  index: number;
  ref: string;
  /** Removed from the new file, with its pop-up and any replies to it. */
  deleted?: boolean;
  /** A new comment. */
  comment?: string;
  /** Drawn again with a new colour or text: the same annotation as ScribeForge would save it. */
  redraw?: AnnotationInput;
  flatten?: boolean;
}

/** Turns pdf.js's id for an annotation ("12R", or "12R3" for generation 3) into its object reference. */
export function parseAnnotationRef(id: string): { num: number; gen: number } | null {
  const m = /^(\d+)R(\d*)$/.exec(id);
  return m ? { num: Number(m[1]), gen: m[2] ? Number(m[2]) : 0 } : null;
}

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
  /** Annotations already in the file: changed, and deleted. */
  annotationsChanged: number;
  annotationsDeleted: number;
  /** Annotations burned into the pages, and those that couldn't be (they have no look of their own). */
  annotationsFlattened: number;
  annotationsNotFlattened: number;
  /** Clean-up: what was left out of the new file. */
  detailsRemoved: number;
  attachmentsRemoved: number;
  formFieldsFlattened: number;
  formFieldsRemoved: number;
  commentsRemoved: number;
  layersRemoved: number;
  hiddenSectionsRemoved: number;
  /** Pages whose hidden content was left in place, because taking it out would move visible text. */
  hiddenContentKept: number;
  bookmarksCleared: number;
  pageDataRemoved: number;
  /** Files attached to a whole document (not to a page), which aren't copied into new files. */
  attachmentsLeftOut: number;
  /** Redaction: pages made into images. */
  pagesRedacted: number;
  /** Redaction: comments, form fields and bookmarks not carried over. */
  commentsLeftOut: number;
  formFieldsLeftOut: number;
  bookmarksLeftOut: number;
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
    annotationsChanged: 0,
    annotationsDeleted: 0,
    annotationsFlattened: 0,
    annotationsNotFlattened: 0,
    detailsRemoved: 0,
    attachmentsRemoved: 0,
    formFieldsFlattened: 0,
    formFieldsRemoved: 0,
    commentsRemoved: 0,
    layersRemoved: 0,
    hiddenSectionsRemoved: 0,
    hiddenContentKept: 0,
    bookmarksCleared: 0,
    pageDataRemoved: 0,
    attachmentsLeftOut: 0,
    pagesRedacted: 0,
    commentsLeftOut: 0,
    formFieldsLeftOut: 0,
    bookmarksLeftOut: 0,
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
  /**
   * Redaction: pages to replace with images, by "source:index". The new file then keeps only
   * the pages and the links between them: no comments, form fields, bookmarks, attachments,
   * details or scripts (Phase 0 plan, question 5).
   */
  redact?: Record<string, RedactedPage>;
  /** Terms that must be found nowhere in the new file; any that are come back in `found`. */
  verifyTerms?: string[];
  /** Changes to annotations that were already in the source files. */
  fileChanges?: FileAnnotationChange[];
  /** Burn every comment-type annotation into its page (not links or form fields). */
  flattenAll?: boolean;
  /** Clean-up: what the new file leaves out. */
  clean?: CleanOptions;
  /** Redaction: what the redacted file keeps besides its pages and the links between them. */
  keep?: RedactKeep;
}

/**
 * What a cleaned file leaves out (Phase 2 plan, 2d). Anything not set stays as any new file keeps
 * it. Scripts and files attached to the whole document are never copied into new files anyway.
 */
export interface CleanOptions {
  /** The document's details, both copies (the classic details and XMP), including non-standard ones. */
  details?: boolean;
  /** Files attached to pages. */
  attachments?: boolean;
  /** Flattened (they keep their look, but the fields and their data go) or removed. */
  formFields?: 'flatten' | 'remove';
  /** Flattened (burned into the page) or removed. */
  comments?: 'flatten' | 'remove';
  /** What's on hidden layers is taken out of the pages, and those layers go. */
  hiddenLayers?: boolean;
  bookmarks?: boolean;
  /** Data other programs keep with a page, and page thumbnails. */
  pageData?: boolean;
}

/** What a redacted file keeps besides its pages and the links between them. All off by default. */
export interface RedactKeep {
  details?: boolean;
  bookmarks?: boolean;
  /** These three on pages without marks (marked pages become pictures, without any of them). */
  comments?: boolean;
  formFields?: boolean;
  attachments?: boolean;
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
  /** Pages with data other programs keep with a page, or a page thumbnail. */
  pageData: number;
  /** Web and email addresses (each once), and how many links go to pages or to other files. */
  links: { web: string[]; webLinks: number; pages: number; otherFiles: number };
  encrypted: boolean;
}

export interface FileReport {
  details: FileDetails;
  carries: Carries;
}

/** A rectangle in a PDF page's own space: left, bottom, right, top. */
export type Rect = [number, number, number, number];

/** A page made into an image for redaction, with its marks already blacked out. */
export interface RedactedPage {
  /** The page as a PNG, drawn upright as the page is in its file (before any turning). */
  png: Uint8Array;
  /** The area of the page the image covers (pdf.js's view: the crop box), in page space. */
  view: Rect;
  /** Dots per inch it was drawn at. */
  dpi: number;
}
