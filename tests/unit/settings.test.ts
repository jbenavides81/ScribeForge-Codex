import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SettingsStore } from '../../src/main/settingsStore';
import { addRecent, applyChange, DEFAULT_SETTINGS, MAX_RECENT, removeRecent, validateSettings } from '../../src/shared/settings';

const tempDir = () => mkdtempSync(path.join(tmpdir(), 'sf-settings-'));

describe('validateSettings', () => {
  it('accepts valid settings unchanged', () => {
    const input = { version: 1, theme: 'light', textSize: 'larger', rememberRecent: true, recentFiles: ['C:\\a.pdf'], authorName: 'Pat', reviewBeforeSave: false };
    const { settings, problems } = validateSettings(input);
    expect(problems).toEqual([]);
    expect(settings).toEqual(input);
  });

  it('falls back to defaults for invalid values and lists each one', () => {
    const { settings, problems } = validateSettings({ theme: 'neon', textSize: 99, rememberRecent: 'yes', recentFiles: 'C:\\a.pdf', authorName: 7, reviewBeforeSave: 'no' });
    expect(settings).toEqual({ ...DEFAULT_SETTINGS, recentFiles: [] });
    expect(problems.sort()).toEqual(['authorName', 'recentFiles', 'rememberRecent', 'reviewBeforeSave', 'textSize', 'theme']);
  });

  it('handles something that is not a settings object at all', () => {
    for (const raw of [null, 42, 'text', ['a']]) {
      const { settings, problems } = validateSettings(raw);
      expect(settings).toEqual({ ...DEFAULT_SETTINGS, recentFiles: [] });
      expect(problems.length).toBe(1);
    }
  });

  it('drops bad recent-file entries, duplicates (ignoring case) and anything past the limit', () => {
    const many = Array.from({ length: 15 }, (_, i) => `C:\\docs\\file${i}.pdf`);
    const { settings, problems } = validateSettings({ recentFiles: ['C:\\A.pdf', 'c:\\a.pdf', 7, '', ...many] });
    expect(problems).toEqual(['recentFiles']);
    expect(settings.recentFiles[0]).toBe('C:\\A.pdf');
    expect(settings.recentFiles).toHaveLength(MAX_RECENT);
  });

  it('keeps no recent files when remembering is off', () => {
    expect(validateSettings({ rememberRecent: false, recentFiles: ['C:\\a.pdf'] }).settings.recentFiles).toEqual([]);
  });
});

describe('author name', () => {
  it('is kept to one tidy line of at most 100 characters', () => {
    expect(validateSettings({ authorName: '  Pat\n\tTester ' }).settings.authorName).toBe('Pat Tester');
    expect(validateSettings({ authorName: 'x'.repeat(150) }).settings.authorName).toHaveLength(100);
    expect(applyChange(DEFAULT_SETTINGS, { authorName: ' Sam ' }).authorName).toBe('Sam');
  });
});

describe('recent files', () => {
  it('puts the newest first, without duplicates, up to the limit', () => {
    let list: string[] = [];
    for (let i = 0; i < 12; i++) list = addRecent(list, `C:\\f${i}.pdf`);
    expect(list).toHaveLength(MAX_RECENT);
    expect(list[0]).toBe('C:\\f11.pdf');
    list = addRecent(list, 'c:\\F5.PDF');
    expect(list[0]).toBe('c:\\F5.PDF');
    expect(list.filter((p) => p.toLowerCase() === 'c:\\f5.pdf')).toHaveLength(1);
  });

  it('removes a file regardless of letter case', () => {
    expect(removeRecent(['C:\\a.pdf', 'C:\\b.pdf'], 'c:\\A.PDF')).toEqual(['C:\\b.pdf']);
  });

  it('turning recent files off clears the list', () => {
    const current = { ...DEFAULT_SETTINGS, recentFiles: ['C:\\a.pdf'] };
    expect(applyChange(current, { rememberRecent: false }).recentFiles).toEqual([]);
  });
});

describe('SettingsStore', () => {
  it('starts with defaults when there is no file, and saves changes', () => {
    const dir = tempDir();
    const store = new SettingsStore(dir);
    expect(store.get()).toEqual({ ...DEFAULT_SETTINGS, recentFiles: [] });
    expect(store.notice).toBeNull();
    store.set({ ...store.get(), theme: 'dark' });
    expect(JSON.parse(readFileSync(path.join(dir, 'settings.json'), 'utf8')).theme).toBe('dark');
    expect(new SettingsStore(dir).get().theme).toBe('dark');
    expect(existsSync(path.join(dir, 'settings.json.tmp'))).toBe(false);
  });

  it('sets a damaged file aside, uses defaults and explains', () => {
    const dir = tempDir();
    writeFileSync(path.join(dir, 'settings.json'), '{ this is not json');
    const store = new SettingsStore(dir, () => new Date('2026-10-15T12:00:00Z'));
    expect(store.get()).toEqual({ ...DEFAULT_SETTINGS, recentFiles: [] });
    expect(store.notice).toContain('settings.damaged-2026-10-15T12-00-00-000Z.json');
    expect(readdirSync(dir)).toContain('settings.damaged-2026-10-15T12-00-00-000Z.json');
    expect(existsSync(path.join(dir, 'settings.json'))).toBe(false);
  });

  it('keeps the valid parts of a partly invalid file and explains', () => {
    const dir = tempDir();
    writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ theme: 'high-contrast', textSize: 'huge' }));
    const store = new SettingsStore(dir);
    expect(store.get().theme).toBe('high-contrast');
    expect(store.get().textSize).toBe('standard');
    expect(store.notice).toMatch(/couldn't be used/);
  });

  it('never saves invalid values', () => {
    const dir = tempDir();
    const store = new SettingsStore(dir);
    store.set({ ...store.get(), theme: 'neon' as never });
    expect(store.get().theme).toBe(DEFAULT_SETTINGS.theme);
  });
});
