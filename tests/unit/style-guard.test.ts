// BC6 style rules, enforced on every screen file:
// colours only from theme variables; Inter at weights 400 and 600; nothing smaller than 13px;
// no italics, all-caps, gradients or shadows. Colour values live only in src/shared/themes.ts.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '../..');
const SCAN = path.join(ROOT, 'src/renderer/src');
const STANDARD_PX = 15; // the smallest text size setting

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(css|tsx?|html)$/.test(f) ? [p] : [];
  });
}

/** Removes comments so the rules don't trip on explanations like this one. */
function stripComments(text: string, file: string): string {
  let out = text.replace(/\/\*[\s\S]*?\*\//g, '');
  if (!file.endsWith('.css')) out = out.replace(/(^|[^:'"])\/\/.*$/gm, '$1');
  return out;
}

const COLOUR_NAMES = ['white', 'black', 'red', 'green', 'blue', 'gray', 'grey', 'yellow', 'orange', 'purple', 'pink'];

function problems(file: string): string[] {
  const text = stripComments(readFileSync(file, 'utf8'), file);
  const found: string[] = [];
  const each = (re: RegExp, describe: (m: RegExpMatchArray) => string | null) => {
    for (const m of text.matchAll(re)) {
      const msg = describe(m);
      if (msg) found.push(msg);
    }
  };
  each(/#[0-9a-fA-F]{3,8}\b/g, (m) => `hard-coded colour ${m[0]}`);
  each(/\b(rgba?|hsla?|hwb|lab|lch|oklch|oklab)\(/g, (m) => `hard-coded colour ${m[0]}`);
  each(new RegExp(`(color|background|border[a-z-]*|fill|stroke)\\s*:\\s*['"]?(${COLOUR_NAMES.join('|')})\\b`, 'gi'), (m) => `named colour "${m[2]}"`);
  each(/font-weight\s*:\s*([^;}]+)|fontWeight\s*:\s*['"]?([^,'"}\s]+)/g, (m) => {
    const v = (m[1] ?? m[2]).trim();
    return v === '400' || v === '600' ? null : `font weight ${v}`;
  });
  each(/font-size\s*:\s*([\d.]+)(px|rem|em)|fontSize\s*:\s*['"]?([\d.]+)(px|rem|em)?/g, (m) => {
    const value = Number(m[1] ?? m[3]);
    const unit = m[2] ?? m[4] ?? 'px';
    const px = unit === 'px' ? value : value * STANDARD_PX;
    return px < 13 ? `text smaller than 13px (${value}${unit} = ${px.toFixed(1)}px)` : null;
  });
  each(/italic/gi, () => 'italics');
  each(/uppercase/gi, () => 'all-caps');
  each(/gradient\(/gi, () => 'gradient');
  each(/(box-shadow|text-shadow|boxShadow|textShadow|filter\s*:\s*drop-shadow)\s*:?\s*['"]?([^;'"}]*)/g, (m) =>
    m[2]?.trim() === 'none' ? null : 'shadow',
  );
  return found;
}

describe('style rules', () => {
  const all = files(SCAN);

  it('finds the screen files', () => {
    expect(all.length).toBeGreaterThan(5);
  });

  for (const file of all) {
    it(path.relative(ROOT, file).replace(/\\/g, '/'), () => {
      expect(problems(file)).toEqual([]);
    });
  }

  it('catches each kind of problem (the guard itself works)', () => {
    const found = problems(path.join(ROOT, 'tests/unit/style-guard.sample.css.txt')).join('\n');
    for (const kind of ['#ff0000', 'rgba(', 'font weight 700', 'smaller than 13px', 'italics', 'all-caps', 'gradient', 'shadow', 'named colour']) {
      expect(found).toContain(kind);
    }
  });
});

describe('fitting small screens', () => {
  it('a dialog taller than the window scrolls, so its buttons can always be reached (found on GitHub\'s 1024 by 768 screen)', () => {
    const css = readFileSync(path.join(SCAN, 'styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const dialog = /\.sf-dialog \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(dialog).toMatch(/max-height: calc\(100vh - 2rem\);/);
    expect(dialog).toMatch(/overflow-y: auto;/);
  });
});
