import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ dialog: {} }));

const { openPath, recentFiles, forgetRecent, clearRecent } = await import('../../src/main/files');
const { SettingsStore } = await import('../../src/main/settingsStore');

const ROOT = path.resolve(import.meta.dirname, '../..');

function setup() {
  const dir = mkdtempSync(path.join(tmpdir(), 'sf-files-'));
  const pdf = path.join(dir, 'Report.pdf');
  // Any bytes do: the main process only reads files; pdf.js checks them in the window.
  writeFileSync(pdf, '%PDF-1.7 test bytes');
  return { dir, pdf, store: new SettingsStore(path.join(dir, 'data')) };
}

const sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');

describe('opening files', () => {
  it('reads a PDF, adds it to recent files and never changes it', async () => {
    const { pdf, store } = setup();
    const before = sha(pdf);
    const result = await openPath(pdf, store);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.file.name).toBe('Report.pdf');
      expect(Buffer.from(result.file.bytes).toString()).toBe('%PDF-1.7 test bytes');
    }
    expect(store.get().recentFiles).toEqual([pdf]);
    expect(sha(pdf)).toBe(before);
  });

  it('refuses relative paths, other file types and missing files', async () => {
    const { dir, store } = setup();
    expect(await openPath('Report.pdf', store)).toMatchObject({ ok: false, reason: 'unreadable' });
    const txt = path.join(dir, 'notes.txt');
    writeFileSync(txt, 'hello');
    expect(await openPath(txt, store)).toMatchObject({ ok: false, reason: 'not-pdf' });
    expect(await openPath(path.join(dir, 'gone.pdf'), store)).toMatchObject({ ok: false, reason: 'not-found' });
    expect(await openPath(dir + path.sep + 'folder.pdf', store)).toMatchObject({ ok: false });
    expect(store.get().recentFiles).toEqual([]);
  });

  it('does not remember files when recent files are turned off', async () => {
    const { pdf, store } = setup();
    store.set({ ...store.get(), rememberRecent: false });
    expect((await openPath(pdf, store)).ok).toBe(true);
    expect(store.get().recentFiles).toEqual([]);
  });

  it('lists, removes and clears recent files, marking missing ones', async () => {
    const { dir, pdf, store } = setup();
    const other = path.join(dir, 'Other.pdf');
    copyFileSync(path.join(ROOT, 'package.json'), other);
    await openPath(pdf, store);
    await openPath(other, store);
    store.set({ ...store.get(), recentFiles: [...store.get().recentFiles, path.join(dir, 'Moved.pdf')] });
    const list = recentFiles(store);
    expect(list.map((f) => [f.name, f.exists])).toEqual([
      ['Other.pdf', true],
      ['Report.pdf', true],
      ['Moved.pdf', false],
    ]);
    expect(forgetRecent(store, other).map((f) => f.name)).toEqual(['Report.pdf', 'Moved.pdf']);
    expect(clearRecent(store)).toEqual([]);
  });
});
