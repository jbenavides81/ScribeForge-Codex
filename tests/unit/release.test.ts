// Stop 4c's required checks (docs/Plan_Phase4.md, section 7): the release script refuses
// uncommitted changes, a version already released, a missing changelog section and out-of-date
// notices; the checksum file is in the usual layout; the release is only the installer, the
// checksum file and the notes, with no update files; nothing personal goes into them. (That the
// app's own files come out the same on two builds is checked by the release script itself.)
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { changelogSection, checksumFile, isUpdateFile, personalDetails, refusals, releaseNotes } from '../../scripts/release-checks.mjs';
import { ROOT } from './support/inspect';

/** A file's text, with Windows line endings (as Git checks files out on Windows) made plain. */
const read = (file: string) => readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');
const { version } = JSON.parse(read('package.json')) as { version: string };
const changelog = read('CHANGELOG.md');
const ready = { version: '1.10.0', changes: [] as string[], branch: 'main', tags: ['v1.9.0'], changelog: '## 1.10.0 (2026-10-26)\n\n- New things.\n\n## 1.9.0\n\n- Old things.\n', noticesFresh: true };
const sums = [
  { name: 'ScribeForge Setup 1.10.0.exe', sha256: 'a'.repeat(64) },
  { name: 'ScribeForge.exe', sha256: 'b'.repeat(64) },
  { name: 'resources/app.asar', sha256: 'c'.repeat(64) },
];

describe('the changelog', () => {
  it('has a section for this version, and a dated section for every version, newest first', () => {
    expect(changelogSection(changelog, version)).toBeTruthy();
    const versions = [...changelog.matchAll(/^## (\d+)\.(\d+)\.(\d+) \((\d{4}-\d{2}-\d{2})\)$/gm)].map((m) => [Number(m[1]), Number(m[2]), Number(m[3])]);
    expect(versions.length).toBe([...changelog.matchAll(/^## /gm)].length);
    expect(versions.at(-1)).toEqual([0, 1, 0]);
    for (let i = 1; i < versions.length; i++) {
      const [a, b] = [versions[i - 1], versions[i]];
      expect(a[0] * 1e6 + a[1] * 1e3 + a[2], `${a.join('.')} before ${b.join('.')}`).toBeGreaterThan(b[0] * 1e6 + b[1] * 1e3 + b[2]);
    }
  });

  it('a section is the text under its heading, up to the next one', () => {
    expect(changelogSection(ready.changelog, '1.10.0')).toBe('- New things.');
    expect(changelogSection(ready.changelog, '1.9.0')).toBe('- Old things.');
    expect(changelogSection(ready.changelog, '1.1.0')).toBeNull(); // not 1.10.0
    expect(changelogSection('## 2.0.0\n\n', '2.0.0')).toBeNull(); // empty
  });
});

describe('the release script refuses', () => {
  it('nothing, when everything is ready', () => {
    expect(refusals(ready)).toEqual([]);
  });

  it('uncommitted changes, another branch, a version already released, no changelog section, and out-of-date notices', () => {
    expect(refusals({ ...ready, changes: [' M README.md'] })).toEqual([expect.stringMatching(/changes that aren't committed \(1 file\)/)]);
    expect(refusals({ ...ready, branch: 'try-things' })).toEqual([expect.stringMatching(/"try-things" branch\. Releases are made from main/)]);
    expect(refusals({ ...ready, tags: ['v1.9.0', 'v1.10.0'] })).toEqual([expect.stringMatching(/1\.10\.0 is already released/)]);
    expect(refusals({ ...ready, changelog: '## 1.9.0\n\n- Old.\n' })).toEqual([expect.stringMatching(/CHANGELOG\.md has no section for 1\.10\.0/)]);
    expect(refusals({ ...ready, noticesFresh: false })).toEqual([expect.stringMatching(/THIRD-PARTY-NOTICES\.md is out of date/)]);
    expect(refusals({ ...ready, version: '1.10' })).toHaveLength(2); // not three numbers, and no section
    expect(refusals({ ...ready, changes: ['?? a', ' M b'], branch: 'x', noticesFresh: false })).toHaveLength(3);
  });
});

describe('the release files', () => {
  it('the checksum file is in the layout sha256sum and Get-FileHash comparisons expect', () => {
    const text = checksumFile(sums);
    expect(text.split('\n').filter(Boolean)).toEqual([`${'a'.repeat(64)}  ScribeForge Setup 1.10.0.exe`, `${'b'.repeat(64)}  ScribeForge.exe`, `${'c'.repeat(64)}  resources/app.asar`]);
  });

  it("the notes give what's new, how to install, and how to check the download, with the installer's checksum as PowerShell shows it", () => {
    const notes = releaseNotes('1.10.0', '- New things.', sums);
    expect(notes).toMatch(/^# ScribeForge 1\.10\.0\n\n- New things\.\n/);
    expect(notes).toContain('Get-FileHash ".\\ScribeForge Setup 1.10.0.exe"');
    expect(notes).toContain('A'.repeat(64));
    expect(notes).toContain(`| \`resources/app.asar\` | \`${'c'.repeat(64)}\` |`);
    expect(notes).toContain('Windows protected your PC');
    expect(personalDetails(notes, 'pat')).toEqual([]);
  });

  it('nothing personal: a user folder path, an email address or the user name is found', () => {
    expect(personalDetails('Built in C:\\Users\\Pat\\repos\\ScribeForge', 'nobody')).toEqual(['a path in a user folder (C:\\Users\\Pat)']);
    expect(personalDetails('Write to someone@example.com', 'nobody')).toEqual(['an email address']);
    expect(personalDetails('Made by Pat', 'pat')).toEqual(['the user name "pat"']);
    expect(personalDetails('Plain release notes', 'pat')).toEqual([]);
  });

  it('only the installer, the checksum file and the notes: the build makes no update files', () => {
    expect(['latest.yml', 'ScribeForge Setup 1.10.0.exe.blockmap'].every(isUpdateFile)).toBe(true);
    expect(['ScribeForge Setup 1.10.0.exe', 'ScribeForge 1.10.0 SHA256SUMS.txt'].some(isUpdateFile)).toBe(false);
    const builder = read('electron-builder.yml');
    expect(builder).toMatch(/^publish: null$/m);
    expect(builder).toMatch(/^ {2}differentialPackage: false$/m);
    expect(JSON.parse(read('package.json')).scripts.release).toBe('node scripts/release.mjs');
  });
});
