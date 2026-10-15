import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '../..');
// Every package whose code or files ship in the app. Keep in step with scripts/make-notices.mjs.
const SHIPPED = [
  'electron',
  'react',
  'react-dom',
  'scheduler',
  'pdfjs-dist',
  'inter-ui',
  '@cantoo/pdf-lib',
  'fflate',
  'tslib',
  'culori',
  'html-entities',
  'node-html-better-parser',
];

describe('third-party notices', () => {
  const notices = readFileSync(path.join(ROOT, 'THIRD-PARTY-NOTICES.md'), 'utf8');

  for (const name of SHIPPED) {
    it(`lists ${name} with its installed version and licence`, () => {
      const pkg = JSON.parse(readFileSync(path.join(ROOT, 'node_modules', name, 'package.json'), 'utf8'));
      expect(notices).toContain(`## ${pkg.name} ${pkg.version}`);
      expect(notices).toContain(`Licence: ${pkg.license}.`);
      expect(['MIT', 'Apache-2.0', 'OFL-1.1', '0BSD', 'BSD-3-Clause', 'ISC']).toContain(pkg.license);
    });
  }

  it('every package the app code imports is listed', () => {
    const walk = (d: string): string[] =>
      readdirSync(d).flatMap((f) => (statSync(path.join(d, f)).isDirectory() ? walk(path.join(d, f)) : [path.join(d, f)]));
    const imported = new Set<string>();
    const specifiers = /from\s+['"]([^'"]+)['"]|import\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]|url\(\s*['"]?([^'")]+)/g;
    for (const file of walk(path.join(ROOT, 'src')).filter((f) => /\.(tsx?|css)$/.test(f))) {
      for (const m of readFileSync(file, 'utf8').matchAll(specifiers)) {
        let spec = (m[1] ?? m[2] ?? m[3] ?? m[4]).split('?')[0];
        const nm = spec.lastIndexOf('node_modules/');
        if (nm !== -1) spec = spec.slice(nm + 'node_modules/'.length);
        else if (spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('node:')) continue;
        const parts = spec.split('/');
        imported.add(spec.startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0]);
      }
    }
    expect(imported.size).toBeGreaterThan(3);
    expect([...imported].filter((p) => !SHIPPED.includes(p))).toEqual([]);
  });
});
