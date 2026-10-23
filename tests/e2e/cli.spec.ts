// Stop 2a: the command-line tool, run as a real program. "dev" runs the built app from out/ with
// Electron; "packaged" runs the installer build's ScribeForge.exe, its scribeforge.cmd launcher,
// and checks the Electron switches set in the program file.
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import fuses from '@electron/fuses';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { findEverywhere, pageIds, pageTexts, rotations } from '../unit/support/inspect';
import { blockedRequests, FIXTURES, PACKAGED_EXE, ROOT, SCREENS, VERSION } from './helpers';

const TERM = 'REDACT-ME-TERM';
const PASSWORD = 'open-sesame';
const ELECTRON = path.join(ROOT, 'node_modules/electron/dist/electron.exe');
const LAUNCHER = path.join(path.dirname(PACKAGED_EXE), 'scribeforge.cmd');
const NETWORK_NOTE = /attempt\(s\) to reach the network/;

const sha = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
const bytesOf = (file: string) => new Uint8Array(readFileSync(file));

/** A folder with copies of the test PDFs, and an empty folder standing in for the app's data. */
function workFolder(): { dir: string; appData: string } {
  const dir = mkdtempSync(path.join(tmpdir(), 'scribeforge-e2e-cli-'));
  for (const name of readdirSync(FIXTURES)) copyFileSync(path.join(FIXTURES, name), path.join(dir, name));
  const appData = path.join(dir, 'app-data');
  mkdirSync(appData);
  return { dir, appData };
}

function environment(appData: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  delete env.ELECTRON_RENDERER_URL;
  delete env.SCRIBEFORGE_TRIAL;
  delete env.ELECTRON_RUN_AS_NODE;
  env.SCRIBEFORGE_USER_DATA = appData;
  env.SCRIBEFORGE_TEST_WINDOW = 'left';
  return env;
}

interface Result {
  code: number | null;
  out: string;
  err: string;
}

/** Runs ScribeForge with a command, the way each project ships it, and waits for it to finish. */
function scribeforge(project: string, cwd: string, appData: string, words: string[], input?: string): Result {
  const [file, args] = project === 'packaged' ? [PACKAGED_EXE, ['--cli', ...words]] : [ELECTRON, [ROOT, ...words]];
  const result = spawnSync(file, args, { cwd, env: environment(appData), input, encoding: 'utf8', timeout: 90_000, windowsHide: true });
  return { code: result.status, out: result.stdout.trim(), err: result.stderr.trim() };
}

test.describe('the command-line tool', () => {
  test.beforeEach(({}, info) => test.skip(info.project.name === 'packaged' && !existsSync(PACKAGED_EXE), 'Run "npm run pack" first.'));

  test('every command works, inputs are never changed, and nothing goes over the network', async ({}, info) => {
    const { dir, appData } = workFolder();
    const at = (name: string) => path.join(dir, name);
    const before = Object.fromEntries(readdirSync(FIXTURES).map((f) => [f, sha(at(f))]));
    const sf = (...words: string[]) => scribeforge(info.project.name, dir, appData, words);

    const version = sf('--version');
    expect(version).toMatchObject({ code: 0, out: `ScribeForge ${VERSION}` });

    const merged = sf('merge', 'links.pdf', 'second.pdf');
    expect(merged.code).toBe(0);
    expect(merged.out.split(/\r?\n/)[0]).toBe(`Saved ${at('links (merged).pdf')} (8 pages).`);
    expect(merged.out).toContain('Scripts and other actions were removed.');
    expect(await pageIds(bytesOf(at('links (merged).pdf')))).toEqual([1, 2, 3, 4, 5, 6].map((n) => `UNIQUE-PAGE-${n}`).concat(['SECOND-DOC-PAGE-1', 'SECOND-DOC-PAGE-2']));

    expect(sf('split', 'links.pdf', '--ranges', '1-2, 6', '-o', 'parts').code).toBe(0);
    expect(readdirSync(at('parts')).sort()).toEqual(['links (page 6).pdf', 'links (pages 1-2).pdf']);

    expect(sf('rotate', 'normal.pdf', '--pages', '2', '--by', '-90', '-o', 'turned.pdf').code).toBe(0);
    expect(await rotations(bytesOf(at('turned.pdf')))).toEqual([0, 270, 0]);

    expect(sf('extract', 'links.pdf', '--pages', '5, 1', '-o', 'two.pdf').code).toBe(0);
    expect(await pageIds(bytesOf(at('two.pdf')))).toEqual(['UNIQUE-PAGE-5', 'UNIQUE-PAGE-1']);

    expect(sf('details', 'normal.pdf', '--title', 'From the command line', '-o', 'titled.pdf').code).toBe(0);
    const info1 = sf('info', 'titled.pdf', '--json');
    expect(info1.code).toBe(0);
    expect(JSON.parse(info1.out).details.shown.title).toBe('From the command line');
    const text = sf('info', 'carries.pdf');
    expect(text.code).toBe(0);
    expect(text.out).toContain('What it carries');

    // Redaction draws its pages in the hidden window, with the app's own code: the same marks as
    // the app's Find and mark (see redact.spec.ts), and the term is found nowhere afterwards.
    const redacted = sf('redact', 'redaction.pdf', '--find', TERM);
    expect(redacted.code).toBe(0);
    expect(redacted.out).toContain("4 marks on 2 pages are blacked out. Those pages are now pictures (200 dpi): their text can't be selected, searched or copied.");
    const out = bytesOf(at('redaction (redacted).pdf'));
    expect(await findEverywhere(out, TERM)).toEqual([]);
    expect((await pageTexts(out)).slice(1)).toEqual(['', '']);
    expect(sf('redact', 'redaction.pdf', '--pages', '1', '--area', '2:72,72,300,200', '--dpi', '150', '-o', 'by-area.pdf').code).toBe(0);
    expect((await pageTexts(bytesOf(at('by-area.pdf')))).slice(0, 2)).toEqual(['', '']);

    // Checking signatures (stop 2e): offline, against the certificate given, and Windows' own.
    const verified = sf('verify', 'signed.pdf', '--trust', 'test-root.cer');
    expect(verified.code).toBe(0);
    expect(verified.out).toContain("This file has 1 signature. It's valid.");
    expect(sf('verify', 'signed-changed.pdf', '--trust', 'test-root.cer')).toMatchObject({ code: 3, out: expect.stringContaining('changed after signing') });

    for (const result of [version, redacted, verified]) expect(result.err).not.toMatch(NETWORK_NOTE);
    for (const [f, hash] of Object.entries(before)) expect(sha(at(f)), f).toBe(hash);
    // It never touches the app's own data folder.
    expect(readdirSync(appData)).toEqual([]);
  });

  test('mistakes and file problems get a plain message and the right exit code', async ({}, info) => {
    const { dir, appData } = workFolder();
    const sf = (...words: string[]) => scribeforge(info.project.name, dir, appData, words);
    expect(sf('merge', 'normal.pdf')).toMatchObject({ code: 1, err: expect.stringContaining('Give at least two PDFs to merge') });
    expect(sf('rotate', 'normal.pdf', '--by', '45')).toMatchObject({ code: 1, err: expect.stringContaining('--by needs a turn of 90, 180 or 270') });
    expect(sf('info', 'missing.pdf')).toMatchObject({ code: 2, err: "missing.pdf couldn't be found." });
    expect(sf('info', 'not-a-pdf.pdf')).toMatchObject({ code: 2, err: "not-a-pdf.pdf isn't really a PDF, or it's damaged." });
    expect(sf('extract', 'normal.pdf', '--pages', '1', '-o', 'normal.pdf', '--overwrite')).toMatchObject({ code: 1 });
    expect(sf('extract', 'normal.pdf', '--pages', '1', '-o', 'second.pdf')).toMatchObject({ code: 2, err: expect.stringContaining('Add --overwrite') });
    expect(sf('redact', 'normal.pdf', '--find', 'no such words')).toMatchObject({ code: 1, err: 'Nothing was marked, so nothing was redacted.' });
    if (info.project.name === 'packaged') {
      // Through ScribeForge.exe with the launcher's marker, a mistyped command is a message, not the app.
      expect(sf('mreg', 'a.pdf')).toMatchObject({ code: 1, err: expect.stringContaining('"mreg" isn\'t a ScribeForge command.') });
    }
  });

  test('a password can come on standard input', async ({}, info) => {
    const { dir, appData } = workFolder();
    const run = (input: string, ...words: string[]) => scribeforge(info.project.name, dir, appData, words, input);
    expect(run(`${PASSWORD}\r\n`, 'extract', 'protected.pdf', '--pages', '1', '-o', 'open.pdf', '--password-stdin')).toMatchObject({ code: 0 });
    expect((await pageTexts(bytesOf(path.join(dir, 'open.pdf'))))[0]).toContain('Protected test document');
    // Windows PowerShell 5.1 starts piped text with a byte-order mark.
    expect(run(`﻿${PASSWORD}\r\n`, 'redact', 'protected.pdf', '--pages', '1', '--password-stdin')).toMatchObject({ code: 0 });
    expect(run('wrong\n', 'info', 'protected.pdf', '--password-stdin')).toMatchObject({ code: 2, err: "That password didn't work for protected.pdf." });
    expect(run('', 'info', 'protected.pdf', '--password-stdin')).toMatchObject({ code: 2, err: 'protected.pdf needs a password, and none came on standard input.' });
  });

  test('otherwise it asks for the password in a small window', async ({}, info) => {
    const { dir, appData } = workFolder();
    const env = environment(appData);
    const words = ['info', path.join(dir, 'protected.pdf')];
    const start = (): Promise<ElectronApplication> =>
      info.project.name === 'packaged'
        ? electron.launch({ executablePath: PACKAGED_EXE, args: words, env, cwd: dir })
        : electron.launch({ args: [ROOT, ...words], env, cwd: dir });

    const app = await start();
    let out = '';
    app.process().stdout?.on('data', (d: Buffer) => (out += d.toString()));
    const exited = new Promise<number | null>((resolve) => app.process().once('exit', (code) => resolve(code)));

    const first = await app.firstWindow();
    await expect(first.getByTestId('cli-password')).toBeVisible();
    await expect(first.getByText('Enter the password for protected.pdf.')).toBeVisible();
    // The window gets only what it needs: none of the app's own abilities.
    expect(await first.evaluate(() => typeof (window as unknown as Record<string, unknown>).scribeforge)).toBe('undefined');
    await first.screenshot({ path: path.join(SCREENS, `cli-password-${info.project.name}.png`) });

    await first.getByLabel('Password').fill('wrong');
    const second = app.waitForEvent('window');
    await first.getByRole('button', { name: 'Open' }).click();
    const retry = await second;
    await expect(retry.getByRole('alert')).toHaveText("That password didn't work. Try again.");
    expect(await blockedRequests(app)).toEqual([]);
    await retry.getByLabel('Password').fill(PASSWORD);
    await retry.getByRole('button', { name: 'Open' }).click();
    expect(await exited).toBe(0);
    expect(out).toContain('Password or restrictions: yes');

    // Cancel (or Escape) stops with a file problem.
    const again = await start();
    let err = '';
    again.process().stderr?.on('data', (d: Buffer) => (err += d.toString()));
    const stopped = new Promise<number | null>((resolve) => again.process().once('exit', (code) => resolve(code)));
    const win = await again.firstWindow();
    // The window closes as the key is pressed, so the key press itself can't finish cleanly.
    await win.getByLabel('Password').press('Escape').catch(() => undefined);
    expect(await stopped).toBe(2);
    expect(err).toContain('protected.pdf needs a password, and none was given.');
  });

  test('the launcher runs from Command Prompt and passes the exit code back', async ({}, info) => {
    test.skip(info.project.name !== 'packaged', 'The launcher ships with the installer build.');
    const { dir, appData } = workFolder();
    const cmd = (line: string) =>
      spawnSync('cmd.exe', ['/d', '/s', '/c', `"${line}"`], { cwd: dir, env: environment(appData), encoding: 'utf8', windowsVerbatimArguments: true, timeout: 90_000, windowsHide: true });
    const merged = cmd(`"${LAUNCHER}" merge normal.pdf second.pdf -o "both files.pdf"`);
    expect(merged.status).toBe(0);
    expect(merged.stdout).toContain(`Saved ${path.join(dir, 'both files.pdf')} (5 pages).`);
    expect(cmd(`"${LAUNCHER}" info missing.pdf`).status).toBe(2);
    expect(cmd(`"${LAUNCHER}" frobnicate`).status).toBe(1);
    // With no command, it shows the help instead of opening the app.
    const help = cmd(`"${LAUNCHER}"`);
    expect(help.status).toBe(0);
    expect(help.stdout).toContain('ScribeForge, from the command line.');
  });

  test("the installed program's Electron switches are set as planned", async ({}, info) => {
    test.skip(info.project.name !== 'packaged', 'Only the installer build sets them.');
    const wire = await fuses.getCurrentFuseWire(PACKAGED_EXE);
    const { FuseV1Options: F } = fuses;
    const on = (id: number) => wire[id as keyof typeof wire] === 49; // "1" in the program file
    expect(on(F.RunAsNode)).toBe(false);
    expect(on(F.EnableNodeOptionsEnvironmentVariable)).toBe(false);
    expect(on(F.OnlyLoadAppFromAsar)).toBe(true);
    expect(on(F.EnableEmbeddedAsarIntegrityValidation)).toBe(true);
    expect(on(F.GrantFileProtocolExtraPrivileges)).toBe(false);
    // Kept on: the whole-app tests drive the installed build through it.
    expect(on(F.EnableNodeCliInspectArguments)).toBe(true);

    // Running as plain Node is refused: the program runs as ScribeForge instead.
    const { dir, appData } = workFolder();
    const asNode = spawnSync(PACKAGED_EXE, ['--cli', '--version'], {
      cwd: dir,
      env: { ...environment(appData), ELECTRON_RUN_AS_NODE: '1' },
      encoding: 'utf8',
      timeout: 60_000,
      windowsHide: true,
    });
    expect(asNode.stdout.trim()).toBe(`ScribeForge ${VERSION}`);
  });
});
