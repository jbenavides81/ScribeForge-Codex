import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DEFAULT_SETTINGS, validateSettings, type Settings } from '../shared/settings';

/**
 * settings.json in the data folder. Writes go to a temporary file first and then replace the
 * old one, so a crash mid-write never leaves a half-written file. A file that can't be read is
 * set aside (renamed, never deleted) and defaults are used, with a notice for the person.
 */
export class SettingsStore {
  readonly file: string;
  private current: Settings;
  /** Set when the file on disk couldn't be used as it was. */
  notice: string | null = null;

  constructor(readonly dir: string, now: () => Date = () => new Date()) {
    this.file = path.join(dir, 'settings.json');
    this.current = this.load(now);
  }

  get(): Settings {
    return structuredClone(this.current);
  }

  set(next: Settings): Settings {
    const { settings } = validateSettings(next);
    this.current = settings;
    this.write();
    return this.get();
  }

  private load(now: () => Date): Settings {
    if (!existsSync(this.file)) return { ...DEFAULT_SETTINGS, recentFiles: [] };
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(this.file, 'utf8'));
    } catch {
      const stamp = now().toISOString().replace(/[:.]/g, '-');
      const aside = path.join(this.dir, `settings.damaged-${stamp}.json`);
      try {
        renameSync(this.file, aside);
      } catch {
        // If it can't be moved aside, it's simply overwritten on the next save.
      }
      this.notice = `Your settings file couldn't be read, so ScribeForge started with its default settings. The old file was kept as ${path.basename(aside)}.`;
      return { ...DEFAULT_SETTINGS, recentFiles: [] };
    }
    const { settings, problems } = validateSettings(raw);
    if (problems.length > 0) {
      this.notice = 'Some of your settings couldn\'t be used, so those went back to their defaults.';
    }
    return settings;
  }

  private write(): void {
    mkdirSync(this.dir, { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.current, null, 2), 'utf8');
    renameSync(tmp, this.file);
  }
}
