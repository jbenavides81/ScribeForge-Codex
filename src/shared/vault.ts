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
  /** How many versions it has (stop 3c); the newest is the one shown and opened. */
  versions: number;
}

/** A new version of a stored document: it keeps the document's title (stop 3c). */
export type NewVersion = Omit<NewDocument, 'title'> & { note?: string };

/** How many automatic backups a backup folder keeps (stop 4a). */
export const BACKUP_KEEP = [5, 10, 20, 50] as const;
export type BackupKeep = (typeof BACKUP_KEEP)[number];

/** A folder that a sync program (or a USB drive) keeps, suggested for automatic backups. */
export interface BackupPlace {
  /** "OneDrive" or "Google Drive". */
  name: string;
  path: string;
}

/** Automatic backups, as the Archive screen shows them (stop 4a). */
export interface BackupStatus {
  /** The backup folder, or null when automatic backups are off. */
  folder: string | null;
  /** Which sync program's folder it's in, if known ("OneDrive", "Google Drive"). */
  place: string | null;
  keep: BackupKeep;
  /** A backup is being copied into the folder now. */
  running: boolean;
  /** The last backup made from this PC: when, and if it failed, why. */
  last: { at: string; ok: boolean; message: string } | null;
  /** A newer backup of this vault, made on another PC; `changedHere` when this vault also changed since its last backup. */
  newer: { created: string; changedHere: boolean } | null;
}

/** What checking a backup found (and, once restored, what it held). */
export interface BackupCheck {
  created: string;
  documents: number;
  /** Every part was checked (a backup file); a backup folder's stored files are checked as they're restored. */
  checkedAll: boolean;
  /** Newer backups in the folder still arriving from another PC. */
  waiting?: number;
  /** For a backup folder: the folder, so automatic backups can carry on there. */
  folder?: string;
}

/** One version of a stored document (stop 3c). */
export interface VaultVersion {
  id: string;
  /** 1 for the first, counting up. */
  number: number;
  added: string;
  pages: number;
  size: number;
  fileName: string;
  note: string;
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
  | 'version-added'
  | 'version-note'
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
