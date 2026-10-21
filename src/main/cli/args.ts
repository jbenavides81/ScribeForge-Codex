// The command-line tool's commands: which words start command-line mode, and what each command
// was asked to do. Plain functions with no Electron, so the unit tests can check every case.
import { parseArgs } from 'node:util';
import type { DocInfo } from '../../engine/types';
import type { Area } from '../../shared/cli';

export type { Area };

export const COMMANDS = ['help', 'merge', 'split', 'rotate', 'extract', 'info', 'details', 'redact'] as const;
export type CommandName = (typeof COMMANDS)[number];

interface Common {
  /** Replace an output file that already exists (never an input). */
  overwrite: boolean;
  /** Read a password from the first line of standard input. */
  passwordStdin: boolean;
}

export type Command =
  | { name: 'help'; topic?: string }
  | { name: 'version' }
  | (Common & { name: 'merge'; inputs: string[]; output?: string })
  | (Common & { name: 'split'; input: string; every?: number; ranges?: string; output?: string })
  | (Common & { name: 'rotate'; input: string; pages: string; by: 90 | 180 | 270; output?: string })
  | (Common & { name: 'extract'; input: string; pages: string; output?: string })
  | (Common & { name: 'info'; input: string; json: boolean })
  | (Common & { name: 'details'; input: string; set: Partial<DocInfo>; output?: string })
  | (Common & { name: 'redact'; input: string; pages?: string; areas: string[]; find: string[]; dpi: 150 | 200 | 300; output?: string });

export type Parsed = { ok: true; command: Command } | { ok: false; error: string; topic?: CommandName };

/**
 * The words given after ScribeForge.exe, when they start a command; otherwise null and the app
 * opens as usual. Electron's own switches (added before the app's words by tools such as test
 * runners) are skipped. In development, the word after the program is the app's folder.
 */
export function commandWords(argv: string[], defaultApp: boolean): string[] | null {
  const words = argv.filter((w) => !/^--(inspect|remote-debugging-port)(=|$)/.test(w)).slice(defaultApp ? 2 : 1);
  const first = words[0];
  // scribeforge.cmd always starts with --cli, so a mistyped command gets a message, not the app.
  if (first === '--cli') return words.slice(1);
  if (first === '--version' || first === '--help' || first === '-h' || first === '/?') return words;
  return first !== undefined && (COMMANDS as readonly string[]).includes(first) ? words : null;
}

const COMMON = {
  output: { type: 'string', short: 'o' },
  overwrite: { type: 'boolean' },
  'password-stdin': { type: 'boolean' },
} as const;

export function parseCommand(words: string[]): Parsed {
  const [first, ...rest] = words;
  if (first === '--version') return { ok: true, command: { name: 'version' } };
  if (first === undefined || first === '--help' || first === '-h' || first === '/?') return { ok: true, command: { name: 'help' } };
  const name = first as CommandName;
  if (name === 'help') return { ok: true, command: { name: 'help', topic: rest[0] } };
  if (!(COMMANDS as readonly string[]).includes(name)) return { ok: false, error: `"${first}" isn't a ScribeForge command.` };
  if (rest.includes('--help') || rest.includes('-h')) return { ok: true, command: { name: 'help', topic: name } };

  // A negative number after an option is its value ("--by -90"), not another option.
  const args: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    if (/^--?\w/.test(rest[i]) && !rest[i].includes('=') && /^-\d/.test(rest[i + 1] ?? '')) args.push(`${rest[i]}=${rest[++i]}`);
    else args.push(rest[i]);
  }

  let values: Record<string, unknown>;
  let positionals: string[];
  try {
    const parsed = parseArgs({
      args,
      allowPositionals: true,
      strict: true,
      options: {
        ...COMMON,
        pages: { type: 'string' },
        by: { type: 'string' },
        every: { type: 'string' },
        ranges: { type: 'string' },
        json: { type: 'boolean' },
        title: { type: 'string' },
        author: { type: 'string' },
        subject: { type: 'string' },
        keywords: { type: 'string' },
        area: { type: 'string', multiple: true },
        find: { type: 'string', multiple: true },
        dpi: { type: 'string' },
      },
    });
    values = parsed.values;
    positionals = parsed.positionals;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const option = /'(-[-\w]+)/.exec(message)?.[1];
    if (option && /argument missing|ambiguous/i.test(message)) return { ok: false, topic: name, error: `"${option}" needs a value after it.` };
    if (option && /does not take an argument/i.test(message)) return { ok: false, topic: name, error: `"${option}" doesn't take a value.` };
    return { ok: false, topic: name, error: option ? `"${option}" isn't something "${name}" understands.` : `That "${name}" command couldn't be read.` };
  }

  const common: Common = { overwrite: values.overwrite === true, passwordStdin: values['password-stdin'] === true };
  const output = typeof values.output === 'string' ? values.output : undefined;
  const allowed: Record<CommandName, string[]> = {
    help: [],
    merge: [],
    split: ['every', 'ranges'],
    rotate: ['pages', 'by'],
    extract: ['pages'],
    info: ['json'],
    details: ['title', 'author', 'subject', 'keywords'],
    redact: ['pages', 'area', 'find', 'dpi'],
  };
  const extra = Object.keys(values).find((k) => !['output', 'overwrite', 'password-stdin', ...allowed[name]].includes(k));
  if (extra) return { ok: false, topic: name, error: `"--${extra}" isn't something "${name}" understands.` };
  if (name === 'info' && output !== undefined) return { ok: false, topic: name, error: '"info" only shows details; it doesn\'t save a file.' };

  const fail = (error: string): Parsed => ({ ok: false, topic: name, error });
  const one = () => {
    if (positionals.length === 0) return fail(`Say which PDF to use, for example: scribeforge ${name} report.pdf`);
    if (positionals.length > 1) return fail(`"${name}" works on one PDF at a time; it was given ${positionals.length}.`);
    return null;
  };

  switch (name) {
    case 'merge':
      if (positionals.length < 2) return fail('Give at least two PDFs to merge, for example: scribeforge merge a.pdf b.pdf');
      return { ok: true, command: { ...common, name, inputs: positionals, output } };
    case 'split': {
      const problem = one();
      if (problem) return problem;
      if (values.every !== undefined && values.ranges !== undefined) return fail('Use either --every or --ranges, not both.');
      let every: number | undefined;
      if (values.every !== undefined) {
        every = Number(values.every);
        if (!Number.isInteger(every) || every < 1) return fail('--every needs a whole number of pages, such as 1 or 5.');
      }
      return { ok: true, command: { ...common, name, input: positionals[0], every, ranges: values.ranges as string | undefined, output } };
    }
    case 'rotate': {
      const problem = one();
      if (problem) return problem;
      const by = Number(values.by ?? '90');
      const turn = ((((by % 360) + 360) % 360) as 0 | 90 | 180 | 270);
      if (!Number.isInteger(by) || by % 90 !== 0 || turn === 0) return fail('--by needs a turn of 90, 180 or 270 degrees (or -90).');
      return { ok: true, command: { ...common, name, input: positionals[0], pages: (values.pages as string | undefined) ?? 'all', by: turn, output } };
    }
    case 'extract': {
      const problem = one();
      if (problem) return problem;
      if (typeof values.pages !== 'string') return fail('Say which pages to extract, for example: --pages "1-3, 5"');
      return { ok: true, command: { ...common, name, input: positionals[0], pages: values.pages, output } };
    }
    case 'info': {
      const problem = one();
      if (problem) return problem;
      return { ok: true, command: { ...common, name, input: positionals[0], json: values.json === true } };
    }
    case 'details': {
      const problem = one();
      if (problem) return problem;
      const set: Partial<DocInfo> = {};
      for (const key of ['title', 'author', 'subject', 'keywords'] as const) if (typeof values[key] === 'string') set[key] = values[key] as string;
      if (Object.keys(set).length === 0) return fail('Say which details to change, for example: --title "Quarterly report"');
      return { ok: true, command: { ...common, name, input: positionals[0], set, output } };
    }
    case 'redact': {
      const problem = one();
      if (problem) return problem;
      const areas = (values.area as string[] | undefined) ?? [];
      const find = ((values.find as string[] | undefined) ?? []).filter((f) => f.trim() !== '');
      const pages = values.pages as string | undefined;
      if (!pages && areas.length === 0 && find.length === 0) return fail('Say what to redact: --pages, --area or --find.');
      const dpi = Number(values.dpi ?? '200');
      if (dpi !== 150 && dpi !== 200 && dpi !== 300) return fail('--dpi can be 150, 200 or 300.');
      for (const area of areas) {
        const problemArea = parseArea(area);
        if (typeof problemArea === 'string') return fail(problemArea);
      }
      return { ok: true, command: { ...common, name, input: positionals[0], pages, areas, find, dpi, output } };
    }
    default:
      return { ok: false, error: `"${first}" isn't a ScribeForge command.` };
  }
}

const MM = 72 / 25.4;

/**
 * "2:72,600,300,640" (points, 72 to the inch) or "2:25,20,105,35mm": page, then left, top, right,
 * bottom, measured from the page's top-left corner as it's shown. A message if it can't be read.
 */
export function parseArea(text: string): Area | string {
  const m = /^\s*(\d+)\s*:\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(mm|pt)?\s*$/i.exec(text);
  if (!m) return `"${text}" isn't an area. Write it as page:left,top,right,bottom, for example 2:72,600,300,640 (points) or 2:25,20,105,35mm.`;
  const scale = m[6]?.toLowerCase() === 'mm' ? MM : 1;
  const [left, top, right, bottom] = [m[2], m[3], m[4], m[5]].map((v) => Number(v) * scale);
  if (Number(m[1]) < 1) return 'Pages are numbered from 1.';
  if (right <= left || bottom <= top) return `In "${text}", right must be more than left, and bottom more than top.`;
  return { page: Number(m[1]), left, top, right, bottom };
}
