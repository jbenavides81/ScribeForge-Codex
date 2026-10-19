import type { ThemeId } from './themes';

export type TextSize = 'standard' | 'large' | 'larger';

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
}

export const MAX_RECENT = 10;
export const MAX_AUTHOR_NAME = 100;

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  theme: 'cathedral',
  textSize: 'standard',
  rememberRecent: true,
  recentFiles: [],
  authorName: '',
  reviewBeforeSave: true,
};

const THEMES: readonly ThemeId[] = ['cathedral', 'light', 'dark', 'high-contrast', 'system'];
const TEXT_SIZES: readonly TextSize[] = ['standard', 'large', 'larger'];

/**
 * Checks settings read from disk. Anything missing or invalid falls back to its default,
 * and each fallback is listed in `problems`.
 */
export function validateSettings(raw: unknown): { settings: Settings; problems: string[] } {
  const problems: string[] = [];
  const settings: Settings = { ...DEFAULT_SETTINGS, recentFiles: [] };
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
  if (!settings.rememberRecent) settings.recentFiles = [];
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

/** Applies a change from the Settings screen. Turning recent files off also clears the list. */
export function applyChange(current: Settings, change: Partial<Omit<Settings, 'version' | 'recentFiles'>>): Settings {
  const { settings } = validateSettings({ ...current, ...change });
  return settings;
}
