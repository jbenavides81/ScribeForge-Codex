// The Archive's vault (docs/Plan_Phase3.md): what the screens and the main process exchange about
// it. The vault itself is src/main/vault/vault.ts.

export const VAULT_LOCK_MINUTES = [5, 10, 15, 30, 60] as const;
export type VaultLockMinutes = (typeof VAULT_LOCK_MINUTES)[number];
export const MIN_VAULT_PASSWORD = 10;

export interface VaultDocument {
  id: string;
  title: string;
  fileName: string;
  added: string;
  pages: number;
  size: number;
  labels: string[];
  note: string;
  voided: { at: string; reason: string } | null;
}

export interface SearchHit {
  /** 1-based. */
  page: number;
  /** Words around the match; the matching words are between MATCH_START and MATCH_END (\u0002 and \u0003). */
  snippet: string;
}

export interface SearchResult {
  document: VaultDocument;
  /** The first few pages found, in page order. */
  hits: SearchHit[];
  /** How many of its pages matched. */
  pagesFound: number;
}

export interface SearchOptions {
  /** Include voided documents. */
  voided?: boolean;
  label?: string;
  /** Only documents added since then (ISO). */
  since?: string;
}

/** A document with pages that have no text, so search can't find words on them. */
export interface TextlessDocument {
  id: string;
  title: string;
  pages: number[];
  voided: boolean;
}

export interface NewDocument {
  fileName: string;
  title: string;
  pages: number;
  bytes: Uint8Array;
  /** A small picture of the first page (PNG), if the window could draw one. */
  thumbnail?: Uint8Array;
  /** Each page's text, read in the window, for the search index. */
  pageTexts?: string[];
}

export type HistoryAction =
  | 'vault-made'
  | 'added'
  | 'renamed'
  | 'labels'
  | 'note'
  | 'voided'
  | 'restored'
  | 'erased'
  | 'copy-saved'
  | 'backup-made'
  | 'backup-restored'
  | 'password-changed'
  | 'recovery-made'
  | 'recovery-used';

export interface HistoryEntry {
  seq: number;
  at: string;
  action: HistoryAction;
  document: string | null;
  /** The document's title at the time (kept even after it's erased). Entries never hold anything
   * else about a document (no labels, notes or file names), since they can't be erased. */
  title: string | null;
  details: Record<string, string>;
}

export interface HistoryCheck {
  entries: HistoryEntry[];
  /** Every entry is sealed to the one before it, and none is missing. */
  intact: boolean;
  /** The first entry that doesn't check out, when it isn't intact. */
  brokenAt?: number;
}

export interface VaultStatus {
  /** A vault has been made on this PC. */
  exists: boolean;
  unlocked: boolean;
  hasRecoveryCode: boolean;
  /** Only while unlocked. */
  documents?: number;
  bytes?: number;
  /** Documents not in the search index yet. */
  unindexed?: number;
  /** The search index couldn't be read, so it's being rebuilt. */
  indexDamaged?: boolean;
}

/** A vault request's answer: what was asked for, or a plain message (and whether it's because the vault is locked). */
export type VaultReply<T> = { ok: true; value: T } | { ok: false; locked: boolean; message: string };
