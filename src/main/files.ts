import { dialog, type BrowserWindow } from 'electron';
import { existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { MAX_FILE_BYTES, type OpenResult, type RecentFile } from '../shared/api';
import { addRecent, removeRecent } from '../shared/settings';
import type { SettingsStore } from './settingsStore';

// Opening files. The main process only shows the dialog and reads the bytes of the file the
// person chose; all PDF parsing happens in the sandboxed window. Files are only ever read here,
// never written.

export async function openWithDialog(win: BrowserWindow, store: SettingsStore): Promise<OpenResult> {
  const result = await dialog.showOpenDialog(win, {
    title: 'Open a PDF',
    properties: ['openFile'],
    filters: [{ name: 'PDF files', extensions: ['pdf'] }],
  });
  if (result.canceled || result.filePaths.length === 0) return { ok: false, reason: 'cancelled' };
  return openPath(result.filePaths[0], store);
}

/** Choose several PDFs at once, to add their pages to the open document. */
export async function openManyWithDialog(win: BrowserWindow, store: SettingsStore): Promise<OpenResult[]> {
  const result = await dialog.showOpenDialog(win, {
    title: 'Add pages from other PDFs',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'PDF files', extensions: ['pdf'] }],
  });
  if (result.canceled) return [];
  const opened: OpenResult[] = [];
  for (const filePath of result.filePaths) opened.push(await openPath(filePath, store));
  return opened;
}

export async function openPath(filePath: string, store: SettingsStore): Promise<OpenResult> {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) {
    return { ok: false, reason: 'unreadable', path: String(filePath) };
  }
  if (path.extname(filePath).toLowerCase() !== '.pdf') return { ok: false, reason: 'not-pdf', path: filePath };
  if (!existsSync(filePath)) return { ok: false, reason: 'not-found', path: filePath };
  try {
    const stat = statSync(filePath);
    if (!stat.isFile()) return { ok: false, reason: 'unreadable', path: filePath };
    if (stat.size > MAX_FILE_BYTES) return { ok: false, reason: 'too-large', path: filePath };
    const bytes = new Uint8Array(await readFile(filePath));
    const settings = store.get();
    if (settings.rememberRecent) store.set({ ...settings, recentFiles: addRecent(settings.recentFiles, filePath) });
    return { ok: true, file: { path: filePath, name: path.basename(filePath), bytes } };
  } catch {
    return { ok: false, reason: 'unreadable', path: filePath };
  }
}

export function recentFiles(store: SettingsStore): RecentFile[] {
  return store.get().recentFiles.map((p) => ({
    path: p,
    name: path.basename(p),
    folder: path.dirname(p),
    exists: existsSync(p),
  }));
}

export function forgetRecent(store: SettingsStore, filePath: string): RecentFile[] {
  const settings = store.get();
  store.set({ ...settings, recentFiles: removeRecent(settings.recentFiles, filePath) });
  return recentFiles(store);
}

export function clearRecent(store: SettingsStore): RecentFile[] {
  store.set({ ...store.get(), recentFiles: [] });
  return recentFiles(store);
}
