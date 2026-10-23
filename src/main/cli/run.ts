// Runs a command-line command with the same engine and the same rules as the app:
// - the files it's given are only read, never changed, and nothing is ever written over them;
// - an existing output file is replaced only with --overwrite;
// - PDF scripts never run, and nothing goes over the network.
// The parts that need Electron (the console, the password window and the hidden window that draws
// redacted pages) come in through `io`, so the unit tests can run every command.
import { PDFDocument } from '@cantoo/pdf-lib';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { buildPdf } from '../../engine/build';
import { inspectPdf } from '../../engine/inspect';
import { certificateDer, parseCertificate, toBase64 } from '../../engine/sign/certificate';
import { checkSignatures } from '../../engine/sign/check';
import type { TrustAnchor } from '../../engine/sign/types';
import { isConfirmed, signaturesSummary, signatureText } from '../../renderer/src/sign/describe';
import { outputName, parseRanges, splitEvery, type OutputKind } from '../../engine/names';
import type { BuildReport, PageItem, RedactedPage, Rotation, SourceInput } from '../../engine/types';
import type { RenderJob, RenderResult } from '../../shared/cli';
import { buildNotes, redactionNotes } from '../../renderer/src/pages/report';
import { plural } from '../../renderer/src/words';
import { MAX_FILE_BYTES } from '../../shared/api';
import { samePath, uniquePath, writeSafely } from '../fileWrite';
import { parseArea, type Area, type Command } from './args';
import { helpText } from './help';
import { infoText } from './info';

export const EXIT = { done: 0, command: 1, file: 2, check: 3 } as const;

export interface CliIo {
  cwd: string;
  version: string;
  out(line: string): void;
  err(line: string): void;
  /** The first line of standard input (for --password-stdin), or null if there's none. */
  stdinLine(): Promise<string | null>;
  /** Asks for a PDF's password, in a small window. Null if the person cancels. */
  askPassword(fileName: string, retry: boolean): Promise<string | null>;
  render(job: RenderJob): Promise<RenderResult>;
  /** Windows' trusted certificates on this PC (DER, base64), for checking signatures. */
  windowsTrust(): string[];
}

/** A problem that ends the command with a plain message and an exit code. */
export class CliError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * The first line of what came on standard input, without its line ending, or null if nothing came.
 * Windows PowerShell 5.1 starts piped text with a byte-order mark, which isn't part of a password.
 */
export function firstLineOf(text: string): string | null {
  const clean = text.replace(/^\uFEFF/, '');
  return clean.length === 0 ? null : clean.split(/\r?\n/)[0];
}

interface Input extends SourceInput {
  path: string;
  pageCount: number;
}

async function readInput(io: CliIo, file: string, id: string, passwords: { stdin?: string | null; useStdin: boolean }): Promise<Input> {
  const full = path.resolve(io.cwd, file);
  const name = path.basename(full);
  if (path.extname(full).toLowerCase() !== '.pdf') throw new CliError(EXIT.file, `${name} isn't a PDF file. ScribeForge opens PDF files only.`);
  if (!existsSync(full) || !statSync(full).isFile()) throw new CliError(EXIT.file, `${file} couldn't be found.`);
  if (statSync(full).size > MAX_FILE_BYTES) throw new CliError(EXIT.file, `${name} is larger than 1 GB, which is more than ScribeForge can open.`);
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(readFileSync(full));
  } catch {
    throw new CliError(EXIT.file, `${name} couldn't be read. Check that it isn't open in another program.`);
  }
  if (!new TextDecoder('latin1').decode(bytes.subarray(0, 1024)).includes('%PDF-')) {
    throw new CliError(EXIT.file, `${name} isn't really a PDF, or it's damaged.`);
  }

  // Open it: with no password first (files locked only against changes open that way), then
  // with one if it needs it. The password is kept in memory only.
  let password: string | undefined;
  for (let attempt = 0; ; attempt++) {
    try {
      const doc = await PDFDocument.load(bytes, { password: password ?? '', updateMetadata: false });
      const pageCount = doc.getPageCount();
      if (pageCount < 1) throw new Error('no pages');
      return { id, name, bytes, password, path: full, pageCount };
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      const needs = /NEEDS PASSWORD/i.test(message);
      const wrong = /password incorrect/i.test(message);
      if (!needs && !wrong) throw new CliError(EXIT.file, `${name} couldn't be read. It may be damaged, or it may not really be a PDF.`);
      if (passwords.useStdin) {
        if (password !== undefined) throw new CliError(EXIT.file, `That password didn't work for ${name}.`);
        if (passwords.stdin === undefined) passwords.stdin = await io.stdinLine();
        if (!passwords.stdin) throw new CliError(EXIT.file, `${name} needs a password, and none came on standard input.`);
        password = passwords.stdin;
        continue;
      }
      if (attempt >= 3) throw new CliError(EXIT.file, `That password didn't work for ${name}.`);
      const asked = await io.askPassword(name, wrong);
      if (asked === null) throw new CliError(EXIT.file, `${name} needs a password, and none was given.`);
      password = asked;
    }
  }
}

/** Where to save: the -o file (checked), or a new name next to the first input. */
function target(io: CliIo, explicit: string | undefined, inputs: Input[], kind: OutputKind, overwrite: boolean): string {
  if (explicit === undefined) return uniquePath(path.dirname(inputs[0].path), outputName(inputs[0].name, kind));
  const full = path.resolve(io.cwd, explicit);
  if (path.extname(full).toLowerCase() !== '.pdf') throw new CliError(EXIT.command, `The new file's name must end in .pdf (${explicit}).`);
  if (inputs.some((i) => samePath(i.path, full))) {
    throw new CliError(EXIT.command, `${path.basename(full)} is one of the files being read. ScribeForge never writes over the files it reads; choose another name.`);
  }
  if (!existsSync(path.dirname(full))) throw new CliError(EXIT.file, `The folder ${path.dirname(full)} doesn't exist.`);
  if (existsSync(full) && !overwrite) throw new CliError(EXIT.file, `${path.basename(full)} already exists. Add --overwrite to replace it, or choose another name.`);
  return full;
}

function save(file: string, bytes: Uint8Array): void {
  try {
    writeSafely(file, bytes);
  } catch {
    throw new CliError(EXIT.file, `${file} couldn't be saved. Check that the folder can be written to, and that the file isn't open in another program.`);
  }
}

/** "1-3, 5" or "all" → 0-based page indexes, in the order given. */
function pageList(text: string, count: number): number[] {
  if (text.trim().toLowerCase() === 'all') return Array.from({ length: count }, (_, i) => i);
  const result = parseRanges(text, count);
  if (!result.ok) throw new CliError(EXIT.command, result.error);
  return result.parts.flat().map((n) => n - 1);
}

const pageItems = (source: string, indexes: number[], rotate: (i: number) => Rotation = () => 0): PageItem[] =>
  indexes.map((index) => ({ kind: 'page', source, index, rotate: rotate(index) }));

const all = (input: Input) => Array.from({ length: input.pageCount }, (_, i) => i);

/** A certificate to trust from --trust: a .cer, .crt or .pem file, as DER or PEM. */
function trustedFile(io: CliIo, file: string): TrustAnchor {
  const full = path.resolve(io.cwd, file);
  const name = path.basename(full);
  if (!existsSync(full) || !statSync(full).isFile()) throw new CliError(EXIT.file, `${file} couldn't be found.`);
  let bytes = new Uint8Array(readFileSync(full));
  const text = new TextDecoder('latin1').decode(bytes.subarray(0, 64));
  if (text.includes('-----BEGIN')) {
    const pem = /-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/.exec(new TextDecoder('latin1').decode(bytes));
    bytes = pem ? new Uint8Array(Buffer.from(pem[1].replace(/\s+/g, ''), 'base64')) : new Uint8Array(0);
  }
  try {
    return { der: toBase64(certificateDer(parseCertificate(bytes))), source: 'mine' };
  } catch {
    throw new CliError(EXIT.file, `${name} isn't a certificate file (.cer, .crt or .pem).`);
  }
}

function report(io: CliIo, lines: string[]): void {
  for (const line of lines) io.out(line);
}

export async function runCommand(command: Command, io: CliIo): Promise<number> {
  try {
    if (command.name === 'help') {
      io.out(helpText(command.topic));
      return EXIT.done;
    }
    if (command.name === 'version') {
      io.out(`ScribeForge ${io.version}`);
      return EXIT.done;
    }
    const passwords = { useStdin: command.passwordStdin } as { stdin?: string | null; useStdin: boolean };
    const producer = `ScribeForge ${io.version}`;
    const built = (out: string, result: { report: BuildReport }) => report(io, [`Saved ${out} (${plural(result.report.pages, 'page')}).`, ...buildNotes(result.report)]);

    switch (command.name) {
      case 'merge': {
        const inputs: Input[] = [];
        for (const [i, file] of command.inputs.entries()) inputs.push(await readInput(io, file, `s${i + 1}`, passwords));
        const out = target(io, command.output, inputs, 'merged', command.overwrite);
        const result = await buildPdf(inputs, inputs.flatMap((input) => pageItems(input.id, all(input))), [], { producer });
        save(out, result.bytes);
        built(out, result);
        return EXIT.done;
      }
      case 'split': {
        const input = await readInput(io, command.input, 's1', passwords);
        let parts: number[][];
        if (command.ranges !== undefined) {
          const ranges = parseRanges(command.ranges, input.pageCount);
          if (!ranges.ok) throw new CliError(EXIT.command, ranges.error);
          parts = ranges.parts;
        } else parts = splitEvery(input.pageCount, command.every ?? 1);
        const folder = command.output ? path.resolve(io.cwd, command.output) : path.dirname(input.path);
        if (existsSync(folder) && !statSync(folder).isDirectory()) throw new CliError(EXIT.command, `${command.output} is a file; for split, -o names a folder.`);
        mkdirSync(folder, { recursive: true });
        const saved: string[] = [];
        for (const part of parts) {
          const result = await buildPdf([input], pageItems(input.id, part.map((n) => n - 1)), [], { producer });
          const out = uniquePath(folder, outputName(input.name, { pages: part }));
          save(out, result.bytes);
          saved.push(out);
        }
        io.out(`Split into ${plural(saved.length, 'file')} in ${folder}:`);
        for (const file of saved) io.out(`  ${path.basename(file)}`);
        return EXIT.done;
      }
      case 'rotate': {
        const input = await readInput(io, command.input, 's1', passwords);
        const turned = new Set(pageList(command.pages, input.pageCount));
        const out = target(io, command.output, [input], 'edited', command.overwrite);
        const result = await buildPdf([input], pageItems(input.id, all(input), (i) => (turned.has(i) ? command.by : 0)), [], { producer });
        save(out, result.bytes);
        built(out, result);
        return EXIT.done;
      }
      case 'extract': {
        const input = await readInput(io, command.input, 's1', passwords);
        const pages = pageList(command.pages, input.pageCount);
        const out = target(io, command.output, [input], { pages: pages.map((i) => i + 1) }, command.overwrite);
        const result = await buildPdf([input], pageItems(input.id, pages), [], { producer });
        save(out, result.bytes);
        built(out, result);
        return EXIT.done;
      }
      case 'info': {
        const input = await readInput(io, command.input, 's1', passwords);
        const result = await inspectPdf(input);
        if (command.json) io.out(JSON.stringify({ file: input.path, ...result }, null, 2));
        else report(io, infoText(input.name, result));
        return EXIT.done;
      }
      case 'details': {
        const input = await readInput(io, command.input, 's1', passwords);
        const { details } = await inspectPdf(input);
        const out = target(io, command.output, [input], 'edited', command.overwrite);
        const result = await buildPdf([input], pageItems(input.id, all(input)), [], { producer, details: { ...details.shown, ...command.set } });
        save(out, result.bytes);
        built(out, result);
        return EXIT.done;
      }
      case 'verify': {
        const trusted = command.trust.map((file) => trustedFile(io, file));
        const input = await readInput(io, command.input, 's1', passwords);
        const checks = await checkSignatures(input.bytes, [...trusted, ...io.windowsTrust().map((der) => ({ der, source: 'windows' as const }))], input.password);
        const ok = checks.length > 0 && checks.every(isConfirmed);
        if (command.json) io.out(JSON.stringify({ file: input.path, ok, signatures: checks }, null, 2));
        else {
          report(io, [input.name, '', signaturesSummary(checks)]);
          for (const check of checks) report(io, ['', ...signatureText(check)]);
        }
        return ok ? EXIT.done : EXIT.check;
      }
      case 'redact': {
        const input = await readInput(io, command.input, 's1', passwords);
        const wholePages = command.pages ? pageList(command.pages, input.pageCount) : [];
        const areas = command.areas.map((a) => parseArea(a) as Area);
        const beyond = areas.find((a) => a.page > input.pageCount);
        if (beyond) throw new CliError(EXIT.command, `${input.name} has no page ${beyond.page}; it has ${plural(input.pageCount, 'page')}.`);
        const out = target(io, command.output, [input], 'redacted', command.overwrite);

        const drawn = await io.render({ bytes: input.bytes, password: input.password, dpi: command.dpi, wholePages, areas, find: command.find });
        for (const term of command.find) if (!drawn.matches[term]) io.out(`"${term}" wasn't found.`);
        if (drawn.marks === 0) throw new CliError(EXIT.command, 'Nothing was marked, so nothing was redacted.');

        const redact: Record<string, RedactedPage> = {};
        for (const [index, page] of Object.entries(drawn.pages)) redact[`${input.id}:${index}`] = page;
        const verify = command.find.filter((t) => drawn.matches[t] > 0);
        const result = await buildPdf([input], pageItems(input.id, all(input)), [], { producer, redact, verifyTerms: verify });
        if (result.found.length > 0) {
          throw new CliError(
            EXIT.check,
            `ScribeForge searched the redacted file and still found ${result.found.map((t) => `"${t}"`).join(', ')}, so nothing was saved. This can happen when a file stores text in an unusual way.`,
          );
        }
        save(out, result.bytes);
        const lowest = Math.min(...Object.values(drawn.pages).map((p) => p.dpi));
        const pages = `${plural(result.report.pages, 'page')}, ${plural(result.report.pagesRedacted, 'page')} redacted`;
        report(io, [`Saved ${out} (${pages}).`, ...redactionNotes(result.report, drawn.marks, 0, lowest)]);
        return EXIT.done;
      }
    }
  } catch (error) {
    if (error instanceof CliError) {
      io.err(error.message);
      return error.code;
    }
    io.err(`Something went wrong: ${error instanceof Error ? error.message : String(error)}`);
    return EXIT.file;
  }
}

