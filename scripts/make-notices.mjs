// Writes THIRD-PARTY-NOTICES.md: every package whose code or files ship inside the app, with its
// version, licence and full licence text, read from node_modules.
//   node scripts/make-notices.mjs
// The release script (scripts/release.mjs) uses noticesText() to check the file is up to date.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Keep in step with tests/unit/notices.test.ts.
export const SHIPPED = [
  { name: 'electron', what: 'The app runtime (Chromium and Node.js). Chromium\'s own notices ship as LICENSES.chromium.html next to the app.' },
  { name: 'react', what: 'Screens' },
  { name: 'react-dom', what: 'Screens' },
  { name: 'scheduler', what: 'Used by React' },
  { name: 'pdfjs-dist', what: 'Viewing, text, search (pdf.js)' },
  { name: '@cantoo/pdf-lib', what: 'The page tools: building new PDFs (a maintained fork of pdf-lib)' },
  { name: 'fflate', what: 'Compression, used by pdf-lib' },
  { name: 'tslib', what: 'Used by pdf-lib' },
  { name: 'culori', what: 'Colour handling, used by pdf-lib' },
  { name: 'html-entities', what: 'Used by pdf-lib' },
  { name: 'node-html-better-parser', what: 'Used by pdf-lib' },
  { name: 'inter-ui', what: 'The Inter font' },
  { name: 'pkijs', what: 'Signing: certificates and signatures (CMS)' },
  { name: 'asn1js', what: 'Signing: the format certificates and signatures are stored in, used by pkijs' },
  { name: 'pvtsutils', what: 'Used by pkijs and asn1js' },
  { name: 'pvutils', what: 'Used by pkijs and asn1js' },
  { name: 'bytestreamjs', what: 'Used by pkijs' },
  // pkijs uses its own copy, which isn't the one the build tools use.
  { name: '@noble/hashes', dir: 'pkijs/node_modules/@noble/hashes', what: 'Hashing, used by pkijs' },
];

function licenceText(dir) {
  for (const f of ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license', 'LICENCE']) {
    const p = path.join(dir, f);
    if (existsSync(p)) return readFileSync(p, 'utf8').trim();
  }
  throw new Error(`No licence file in ${dir}`);
}

/** What THIRD-PARTY-NOTICES.md should say, from the packages installed now. */
export function noticesText(root = process.cwd()) {
  let out = '# Third-party notices\n\nScribeForge includes the following open-source software. Thank you to everyone who made it.\n';
  for (const { name, dir: where, what } of SHIPPED) {
    const dir = path.resolve(root, 'node_modules', where ?? name);
    const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
    out += `\n---\n\n## ${pkg.name} ${pkg.version}\n\n${what}. Licence: ${pkg.license}.\n\n${licenceText(dir)}\n`;
  }
  return out.replace(/\r\n/g, '\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  writeFileSync('THIRD-PARTY-NOTICES.md', noticesText());
  console.log(`Wrote THIRD-PARTY-NOTICES.md (${SHIPPED.length} packages)`);
}
