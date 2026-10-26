// Plain words for the Archive: its history, why it locked, and its backups. No screen code, so the unit
// tests can check every sentence.
import type { BackupStatus, HistoryCheck, HistoryEntry } from '../../../shared/vault';
import { formatDate } from '../details/describe';

const named = (e: HistoryEntry) => `“${e.title ?? 'a document'}”`;

/** One history entry in a sentence. */
export function historyText(e: HistoryEntry): string {
  switch (e.action) {
    case 'vault-made':
      return e.details.recovery === 'yes' ? 'The vault was made, with a recovery code.' : 'The vault was made.';
    case 'added':
      return `${named(e)} was added.`;
    case 'version-added':
      return `Version ${e.details.version ?? ''} of ${named(e)} was added.`;
    case 'version-note':
      return `The note on version ${e.details.version ?? ''} of ${named(e)} was changed.`;
    case 'renamed':
      return `“${e.details.from ?? ''}” was renamed ${named(e)}.`;
    case 'labels':
      return `The labels of ${named(e)} were changed.`;
    case 'note':
      return `The note on ${named(e)} was changed.`;
    case 'voided':
      return `${named(e)} was voided. Reason: ${e.details.reason ?? ''}`;
    case 'restored':
      return `${named(e)} was restored.`;
    case 'erased':
      return `${named(e)} was erased for good. Reason: ${e.details.reason ?? ''}`;
    case 'copy-saved':
      return `A copy of ${named(e)} was saved out of the vault.`;
    case 'backup-made':
      return 'A backup was made.';
    case 'backup-restored':
      return `The vault was restored from a backup made on ${formatDate(e.details.made)}.`;
    case 'password-changed':
      return 'The password was changed.';
    case 'recovery-made':
      return e.details.replaced === 'yes' ? 'A new recovery code was made; the old one no longer works.' : 'A recovery code was made.';
    case 'recovery-used':
      return 'The vault was opened with the recovery code.';
    default:
      return 'Something else happened.';
  }
}

/** Whether the history checks out, in a sentence. */
export function historyState(check: HistoryCheck): string {
  return check.intact
    ? `The history is intact: ${check.entries.length === 1 ? '1 entry' : `${check.entries.length} entries`}, each sealed to the one before it.`
    : `The history has been changed outside ScribeForge, from entry ${check.brokenAt} on. Entries from there may have been changed, removed or reordered.`;
}

/** The history as a text file. */
export function historyFile(check: HistoryCheck, savedAt: Date): string {
  return [
    'ScribeForge Archive: history',
    `Saved ${formatDate(savedAt.toISOString())}`,
    historyState(check),
    '',
    ...check.entries.map((e) => `${e.seq}. ${formatDate(e.at)}  ${historyText(e)}`),
    '',
  ].join('\r\n');
}

/** Why the vault locked by itself, in a sentence; null when the person locked it. */
export function lockedBecause(why: string): string | null {
  switch (why) {
    case 'idle':
      return 'The Archive locked itself, because ScribeForge wasn\'t used for a while.';
    case 'windows-locked':
      return 'The Archive locked, because Windows locked.';
    case 'sleep':
      return 'The Archive locked, because the PC went to sleep.';
    default:
      return null;
  }
}

/** How automatic backups are doing, in one line (stop 4a). */
export function backupStatusText(status: BackupStatus): string {
  if (!status.folder) return 'Off.';
  if (status.running) return 'Backing up…';
  if (!status.last) return 'No backup yet.';
  if (!status.last.ok) return `The last backup didn't work. ${status.last.message}`;
  return `Last backup: ${formatDate(status.last.at)}.`;
}

/** The offer of a newer backup made on another PC. */
export function newerBackupText(newer: NonNullable<BackupStatus['newer']>): string {
  const base = `There's a newer backup of this vault in the backup folder, made on another PC on ${formatDate(newer.created)}.`;
  return newer.changedHere ? `${base} This vault has changes too, made here since its last backup: restoring the newer backup replaces them.` : base;
}
