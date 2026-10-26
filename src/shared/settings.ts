import type { ThemeId } from './themes';
import { BACKUP_KEEP, VAULT_LOCK_MINUTES, type BackupKeep, type VaultLockMinutes } from './vault';

export type TextSize = 'standard' | 'large' | 'larger';
/** How sharp redacted pages are, in dots per inch (Phase 0 plan, question 4). */
export type RedactionDpi = 150 | 200 | 300;
export const REDACTION_DPIS: readonly RedactionDpi[] = [150, 200, 300];

export interface Settings {
  version: 1;
  theme: ThemeId;
  textSize: TextSize;
  rememberRecent: boolean;
  recentFiles: string[];
  /** Saved as the author of annotations. Empty: annotations have no author. */
  authorName: string;
  /** Before saving, show what the new file carries (details, attachments, comments, …). */
  reviewBeforeSave: boolean;
  redactionDpi: RedactionDpi;
  /** Where the certificate file used for signing is (its location only, never its password). Forgotten with the recent files. */
  certificateFile: string;
  /** Certificates the person chose to trust when checking signatures (DER, base64; nothing secret). */
  trustedCertificates: string[];
  /** The Archive locks after this many minutes without using ScribeForge. */
  vaultLockMinutes: VaultLockMinutes;
  /** The backup folder automatic backups go to (stop 4a); empty when they're off. */
  archiveBackupFolder: string;
  /** How many automatic backups of the vault the backup folder keeps. */
  archiveBackupKeep: BackupKeep;
  /** A random tag for this PC (this copy of ScribeForge), in the names of the backups it makes. Not a name. */
  installId: string;
  /** For each vault (by its tag): when it was last backed up or restored here, and what it held then, to tell whether it changed since. */
  archiveBackupState: Record<string, { at: string; state: string }>;
  /**
   * Stored files erased for good that are still to be removed from the backup folder (it wasn't
   * there when they were erased), by vault tag. Random names only.
   */
  archiveBackupErased: Record<string, string[]>;
}

export const MAX_RECENT = 10;
export const MAX_TRUSTED = 100;
export const MAX_AUTHOR_NAME = 100;
/** Vaults whose last backup is remembered (one usually; more after restoring others). */
export const MAX_BACKUP_STATES = 10;

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  theme: 'cathedral',
  textSize: 'standard',
  rememberRecent: true,
  recentFiles: [],
  authorName: '',
  reviewBeforeSave: true,
  redactionDpi: 200,
  certificateFile: '',
  trustedCertificates: [],
  vaultLockMinutes: 10,
  archiveBackupFolder: '',
  archiveBackupKeep: 10,
  installId: '',
  archiveBackupState: {},
  archiveBackupErased: {},
};

const THEMES: readonly ThemeId[] = ['cathedral', 'light', 'dark', 'high-contrast', 'system'];
const TEXT_SIZES: readonly TextSize[] = ['standard', 'large', 'larger'];

/**
 * Checks settings read from disk. Anything missing or invalid falls back to its default,
 * and each fallback is listed in `problems`.
 */
export function validateSettings(raw: unknown): { settings: Settings; problems: string[] } {
  const problems: string[] = [];
  const settings: Settings = { ...DEFAULT_SETTINGS, recentFiles: [], trustedCertificates: [], archiveBackupState: {}, archiveBackupErased: {} };
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { settings, problems: ['the settings were not a list of values'] };
  }
  const r = raw as Record<string, unknown>;

  if (r.theme !== undefined) {
    if (THEMES.includes(r.theme as ThemeId)) settings.theme = r.theme as ThemeId;
    else problems.push('theme');
  }
  if (r.textSize !== undefined) {
    if (TEXT_SIZES.includes(r.textSize as TextSize)) settings.textSize = r.textSize as TextSize;
    else problems.push('textSize');
  }
  if (r.rememberRecent !== undefined) {
    if (typeof r.rememberRecent === 'boolean') settings.rememberRecent = r.rememberRecent;
    else problems.push('rememberRecent');
  }
  if (r.recentFiles !== undefined) {
    if (Array.isArray(r.recentFiles)) {
      const paths = r.recentFiles.filter((p): p is string => typeof p === 'string' && p.length > 0 && p.length < 4096);
      if (paths.length !== r.recentFiles.length) problems.push('recentFiles');
      settings.recentFiles = dedupePaths(paths).slice(0, MAX_RECENT);
    } else {
      problems.push('recentFiles');
    }
  }
  if (r.authorName !== undefined) {
    if (typeof r.authorName === 'string') settings.authorName = cleanName(r.authorName);
    else problems.push('authorName');
  }
  if (r.reviewBeforeSave !== undefined) {
    if (typeof r.reviewBeforeSave === 'boolean') settings.reviewBeforeSave = r.reviewBeforeSave;
    else problems.push('reviewBeforeSave');
  }
  if (r.redactionDpi !== undefined) {
    if (REDACTION_DPIS.includes(r.redactionDpi as RedactionDpi)) settings.redactionDpi = r.redactionDpi as RedactionDpi;
    else problems.push('redactionDpi');
  }
  if (r.certificateFile !== undefined) {
    if (typeof r.certificateFile === 'string' && r.certificateFile.length < 4096) settings.certificateFile = r.certificateFile;
    else problems.push('certificateFile');
  }
  if (r.trustedCertificates !== undefined) {
    if (Array.isArray(r.trustedCertificates)) {
      const list = r.trustedCertificates.filter((c): c is string => typeof c === 'string' && c.length > 0 && c.length < 100_000 && /^[A-Za-z0-9+/]+=*$/.test(c));
      if (list.length !== r.trustedCertificates.length) problems.push('trustedCertificates');
      settings.trustedCertificates = [...new Set(list)].slice(0, MAX_TRUSTED);
    } else problems.push('trustedCertificates');
  }
  if (r.vaultLockMinutes !== undefined) {
    if (VAULT_LOCK_MINUTES.includes(r.vaultLockMinutes as VaultLockMinutes)) settings.vaultLockMinutes = r.vaultLockMinutes as VaultLockMinutes;
    else problems.push('vaultLockMinutes');
  }
  if (r.archiveBackupFolder !== undefined) {
    if (typeof r.archiveBackupFolder === 'string' && r.archiveBackupFolder.length < 4096) settings.archiveBackupFolder = r.archiveBackupFolder;
    else problems.push('archiveBackupFolder');
  }
  if (r.archiveBackupKeep !== undefined) {
    if (BACKUP_KEEP.includes(r.archiveBackupKeep as BackupKeep)) settings.archiveBackupKeep = r.archiveBackupKeep as BackupKeep;
    else problems.push('archiveBackupKeep');
  }
  if (r.installId !== undefined) {
    if (typeof r.installId === 'string' && /^([0-9a-f]{12})?$/.test(r.installId)) settings.installId = r.installId;
    else problems.push('installId');
  }
  if (r.archiveBackupState !== undefined) {
    const state = r.archiveBackupState;
    if (typeof state === 'object' && state !== null && !Array.isArray(state)) {
      for (const [tag, v] of Object.entries(state as Record<string, unknown>).slice(0, MAX_BACKUP_STATES)) {
        const entry = v as { at?: unknown; state?: unknown };
        if (/^[0-9a-f]{12}$/.test(tag) && typeof entry?.at === 'string' && typeof entry.state === 'string' && entry.state.length < 100) settings.archiveBackupState[tag] = { at: entry.at, state: entry.state };
      }
    } else problems.push('archiveBackupState');
  }
  if (r.archiveBackupErased !== undefined) {
    const erased = r.archiveBackupErased;
    if (typeof erased === 'object' && erased !== null && !Array.isArray(erased)) {
      for (const [tag, names] of Object.entries(erased as Record<string, unknown>).slice(0, MAX_BACKUP_STATES)) {
        if (!/^[0-9a-f]{12}$/.test(tag) || !Array.isArray(names)) continue;
        const list = names.filter((n): n is string => typeof n === 'string' && /^[0-9a-f-]{36}\.sealed$/.test(n)).slice(0, 10_000);
        if (list.length) settings.archiveBackupErased[tag] = list;
      }
    } else problems.push('archiveBackupErased');
  }
  if (!settings.rememberRecent) {
    settings.recentFiles = [];
    settings.certificateFile = '';
  }
  return { settings, problems };
}

/** One line, no control characters, at most MAX_AUTHOR_NAME characters. */
export function cleanName(name: string): string {
  return name
    .replace(/\p{Cc}+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_AUTHOR_NAME);
}

/** Windows paths are case-insensitive. */
function samePath(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function dedupePaths(paths: string[]): string[] {
  const out: string[] = [];
  for (const p of paths) if (!out.some((q) => samePath(p, q))) out.push(p);
  return out;
}

/** Puts `path` first in the list, without duplicates, keeping at most MAX_RECENT. */
export function addRecent(list: readonly string[], path: string): string[] {
  return [path, ...list.filter((p) => !samePath(p, path))].slice(0, MAX_RECENT);
}

export function removeRecent(list: readonly string[], path: string): string[] {
  return list.filter((p) => !samePath(p, path));
}

/** Applies a change from the Settings screen. Turning recent files off also clears the list, and the certificate file's location. */
export function applyChange(current: Settings, change: Partial<Omit<Settings, 'version' | 'recentFiles' | 'certificateFile' | 'trustedCertificates'>>): Settings {
  // Only what the Settings screen changes: the recent files, the certificate file and the trusted
  // certificates have their own requests (and trusting one asks first).
  const allowed = ['theme', 'textSize', 'rememberRecent', 'authorName', 'reviewBeforeSave', 'redactionDpi', 'vaultLockMinutes'] as const;
  const picked = Object.fromEntries(allowed.filter((k) => change[k] !== undefined).map((k) => [k, change[k]]));
  const { settings } = validateSettings({ ...current, ...picked });
  return settings;
}
