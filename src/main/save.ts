import { dialog, type BrowserWindow } from 'electron';
import path from 'node:path';
import type { SaveManyRequest, SaveManyResult, SaveRequest, SaveResult } from '../shared/api';
import { safeFileName } from '../engine/names';
import { samePath, uniquePath, writeSafely } from './fileWrite';

// Saving. ScribeForge writes only where the person chose in a dialog, never over an existing file
// without asking, and replacing an original asks a second, plain question first.

function pdfName(name: string): string {
  return `${safeFileName(name.replace(/\.pdf$/i, ''))}.pdf`;
}

function isBytes(v: unknown): v is Uint8Array {
  return v instanceof Uint8Array && v.length > 0;
}

export async function saveWithDialog(win: BrowserWindow, req: SaveRequest): Promise<SaveResult> {
  if (!req || !isBytes(req.bytes) || typeof req.suggestedName !== 'string') return { ok: false, reason: 'failed', message: 'Nothing to save.' };
  const sources = Array.isArray(req.sourcePaths) ? req.sourcePaths.filter((p) => typeof p === 'string') : [];
  const folder = sources[0] ? path.dirname(sources[0]) : undefined;
  const name = pdfName(req.suggestedName);
  const result = await dialog.showSaveDialog(win, {
    title: 'Save as a new PDF',
    defaultPath: folder ? uniquePath(folder, name) : name,
    filters: [{ name: 'PDF files', extensions: ['pdf'] }],
    properties: ['showOverwriteConfirmation'],
  });
  if (result.canceled || !result.filePath) return { ok: false, reason: 'cancelled' };
  let target = result.filePath;
  if (path.extname(target).toLowerCase() !== '.pdf') target = `${target}.pdf`;

  const original = sources.find((s) => samePath(s, target));
  if (original) {
    const answer = await dialog.showMessageBox(win, {
      type: 'warning',
      title: 'Replace the original file?',
      message: `This replaces the original file, ${path.basename(original)}.`,
      detail: 'ScribeForge normally saves a new file and leaves the original as it was. If you replace it, the original can\'t be got back.',
      buttons: ['Replace the original', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    });
    if (answer.response !== 0) return { ok: false, reason: 'cancelled' };
  }
  try {
    writeSafely(target, req.bytes);
    return { ok: true, path: target };
  } catch {
    return { ok: false, reason: 'failed', message: `ScribeForge couldn't save ${path.basename(target)}. Check the folder isn't read-only and the file isn't open in another program.` };
  }
}

export async function saveManyWithDialog(win: BrowserWindow, req: SaveManyRequest): Promise<SaveManyResult> {
  const files = Array.isArray(req?.files) ? req.files.filter((f) => f && typeof f.name === 'string' && isBytes(f.bytes)) : [];
  if (files.length === 0) return { ok: false, reason: 'failed', message: 'Nothing to save.' };
  const sources = Array.isArray(req.sourcePaths) ? req.sourcePaths.filter((p) => typeof p === 'string') : [];
  const result = await dialog.showOpenDialog(win, {
    title: 'Choose a folder for the new files',
    defaultPath: sources[0] ? path.dirname(sources[0]) : undefined,
    buttonLabel: 'Save here',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return { ok: false, reason: 'cancelled' };
  const folder = result.filePaths[0];
  const saved: string[] = [];
  try {
    for (const file of files) {
      const target = uniquePath(folder, pdfName(file.name));
      writeSafely(target, file.bytes);
      saved.push(target);
    }
    return { ok: true, folder, paths: saved };
  } catch {
    return {
      ok: false,
      reason: 'failed',
      message: `ScribeForge saved ${saved.length} of ${files.length} files, then couldn't save the rest. Check the folder isn't read-only.`,
    };
  }
}
