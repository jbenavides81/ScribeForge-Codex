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

export interface NewDocument {
  fileName: string;
  title: string;
  pages: number;
  bytes: Uint8Array;
  /** A small picture of the first page (PNG), if the window could draw one. */
  thumbnail?: Uint8Array;
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
}

/** A vault request's answer: what was asked for, or a plain message (and whether it's because the vault is locked). */
export type VaultReply<T> = { ok: true; value: T } | { ok: false; locked: boolean; message: string };
