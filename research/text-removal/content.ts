// RESEARCH PROTOTYPE (stop 2c), not part of the app: reads a page's drawing instructions (a PDF
// content stream) into operators and their operands, and writes them back. Handles numbers,
// strings (literal and hex), names, arrays, dictionaries and inline images (ISO 32000-1, 7.8 and
// 8.9.7). See docs/Research_TextRemoval.md.

export type Value =
  | { kind: 'num'; value: number; raw: string }
  | { kind: 'str'; bytes: Uint8Array }
  | { kind: 'name'; value: string }
  | { kind: 'arr'; items: Value[] }
  | { kind: 'dict'; entries: [string, Value][] }
  | { kind: 'word'; value: string }; // true, false, null

export interface Op {
  op: string;
  args: Value[];
  /** An inline image's data (between ID and EI). */
  data?: Uint8Array;
}

const WHITE = new Set([0, 9, 10, 12, 13, 32]);
const DELIM = new Set([...'()<>[]{}/%'].map((c) => c.charCodeAt(0)));

export function parseContent(bytes: Uint8Array): Op[] {
  let i = 0;
  const ops: Op[] = [];
  let stack: Value[] = [];

  const skipSpace = () => {
    while (i < bytes.length) {
      if (WHITE.has(bytes[i])) i++;
      else if (bytes[i] === 37) while (i < bytes.length && bytes[i] !== 10 && bytes[i] !== 13) i++;
      else break;
    }
  };

  const readLiteral = (): Uint8Array => {
    const out: number[] = [];
    let depth = 1;
    i++; // (
    while (i < bytes.length) {
      const c = bytes[i++];
      if (c === 92) {
        const n = bytes[i++];
        const simple: Record<number, number> = { 110: 10, 114: 13, 116: 9, 98: 8, 102: 12, 40: 40, 41: 41, 92: 92 };
        if (n in simple) out.push(simple[n]);
        else if (n >= 48 && n <= 55) {
          let code = n - 48;
          for (let k = 0; k < 2 && bytes[i] >= 48 && bytes[i] <= 55; k++) code = code * 8 + (bytes[i++] - 48);
          out.push(code & 255);
        } else if (n === 13) {
          if (bytes[i] === 10) i++;
        } else if (n !== 10) out.push(n);
      } else if (c === 40) {
        depth++;
        out.push(c);
      } else if (c === 41) {
        if (--depth === 0) break;
        out.push(c);
      } else out.push(c);
    }
    return new Uint8Array(out);
  };

  const readHex = (): Uint8Array => {
    i++; // <
    let hex = '';
    while (i < bytes.length && bytes[i] !== 62) {
      if (!WHITE.has(bytes[i])) hex += String.fromCharCode(bytes[i]);
      i++;
    }
    i++; // >
    if (hex.length % 2) hex += '0';
    return new Uint8Array(hex.match(/../g)?.map((h) => parseInt(h, 16)) ?? []);
  };

  const readRegular = (): string => {
    const start = i;
    while (i < bytes.length && !WHITE.has(bytes[i]) && !DELIM.has(bytes[i])) i++;
    return String.fromCharCode(...bytes.subarray(start, i));
  };

  const readValue = (): Value | null => {
    skipSpace();
    const c = bytes[i];
    if (c === 40) return { kind: 'str', bytes: readLiteral() };
    if (c === 60 && bytes[i + 1] === 60) {
      i += 2;
      const entries: [string, Value][] = [];
      for (;;) {
        skipSpace();
        if (bytes[i] === 62 && bytes[i + 1] === 62) {
          i += 2;
          return { kind: 'dict', entries };
        }
        const key = readValue();
        const value = readValue();
        if (!key || key.kind !== 'name' || !value) throw new Error('Bad dictionary in content');
        entries.push([key.value, value]);
      }
    }
    if (c === 60) return { kind: 'str', bytes: readHex() };
    if (c === 91) {
      i++;
      const items: Value[] = [];
      for (;;) {
        skipSpace();
        if (bytes[i] === 93) {
          i++;
          return { kind: 'arr', items };
        }
        const v = readValue();
        if (!v) throw new Error('Bad array in content');
        items.push(v);
      }
    }
    if (c === 47) {
      i++;
      return { kind: 'name', value: readRegular().replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))) };
    }
    const word = readRegular();
    if (word === '') {
      i++;
      return null;
    }
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) return { kind: 'num', value: Number(word), raw: word };
    if (word === 'true' || word === 'false' || word === 'null') return { kind: 'word', value: word };
    // An operator.
    return { kind: 'word', value: `\u0000${word}` };
  };

  while (i < bytes.length) {
    skipSpace();
    if (i >= bytes.length) break;
    const v = readValue();
    if (!v) continue;
    if (v.kind === 'word' && v.value.startsWith('\u0000')) {
      const op = v.value.slice(1);
      if (op === 'BI') {
        // Inline image: key/value pairs, ID, one white-space byte, data, then EI.
        const entries: [string, Value][] = [];
        for (;;) {
          skipSpace();
          if (bytes[i] === 73 && bytes[i + 1] === 68 && (WHITE.has(bytes[i + 2]) || i + 2 >= bytes.length)) break;
          const key = readValue();
          const value = readValue();
          if (!key || key.kind !== 'name' || !value) throw new Error('Bad inline image');
          entries.push([key.value, value]);
        }
        i += 3;
        const start = i;
        while (i < bytes.length && !(WHITE.has(bytes[i - 1]) && bytes[i] === 69 && bytes[i + 1] === 73 && (i + 2 >= bytes.length || WHITE.has(bytes[i + 2])))) i++;
        ops.push({ op: 'BI', args: [{ kind: 'dict', entries }], data: bytes.slice(start, Math.max(start, i - 1)) });
        i += 2;
        stack = [];
        continue;
      }
      ops.push({ op, args: stack });
      stack = [];
    } else stack.push(v);
  }
  return ops;
}

const hex = (b: Uint8Array) => `<${[...b].map((x) => x.toString(16).padStart(2, '0')).join('')}>`;
const nameText = (n: string) => `/${[...n].map((c) => (/[!-~]/.test(c) && !'()<>[]{}/%#'.includes(c) ? c : `#${c.charCodeAt(0).toString(16).padStart(2, '0')}`)).join('')}`;

export function writeValue(v: Value): string {
  switch (v.kind) {
    case 'num':
      return v.raw;
    case 'str':
      return hex(v.bytes);
    case 'name':
      return nameText(v.value);
    case 'arr':
      return `[${v.items.map(writeValue).join(' ')}]`;
    case 'dict':
      return `<<${v.entries.map(([k, x]) => `${nameText(k)} ${writeValue(x)}`).join(' ')}>>`;
    case 'word':
      return v.value;
  }
}

export function writeContent(ops: Op[]): Uint8Array {
  const parts: Uint8Array[] = [];
  const enc = new TextEncoder();
  for (const o of ops) {
    if (o.op === 'BI') {
      const dict = o.args[0];
      const entries = dict.kind === 'dict' ? dict.entries : [];
      parts.push(enc.encode(`BI ${entries.map(([k, x]) => `${nameText(k)} ${writeValue(x)}`).join(' ')} ID `), o.data ?? new Uint8Array(), enc.encode('\nEI\n'));
    } else parts.push(enc.encode(`${[...o.args.map(writeValue), o.op].join(' ')}\n`));
  }
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export const num = (n: number): Value => {
  const r = Math.round(n * 10000) / 10000;
  return { kind: 'num', value: r, raw: String(Object.is(r, -0) ? 0 : r) };
};
