// Writing files safely: never over an existing file by accident, and never half a file. Used by
// the app's Save dialogs and by the command-line tool.
import { existsSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const samePath = (a: string, b: string) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

/** `dir\name.pdf`, or `dir\name 2.pdf`, `dir\name 3.pdf`… if that file already exists. */
export function uniquePath(dir: string, fileName: string): string {
  const ext = path.extname(fileName);
  const base = fileName.slice(0, fileName.length - ext.length);
  let candidate = path.join(dir, fileName);
  for (let n = 2; existsSync(candidate); n++) candidate = path.join(dir, `${base} ${n}${ext}`);
  return candidate;
}

/** Writes to a temporary file first, then puts it in place, so a failed save never leaves half a file. */
export function writeSafely(target: string, bytes: Uint8Array): void {
  const temp = `${target}.scribeforge-saving`;
  try {
    writeFileSync(temp, bytes);
    renameSync(temp, target);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
}
