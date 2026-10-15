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
  };
}
