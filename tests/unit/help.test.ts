// The help pages (content/help/*.md) and the Markdown reader that shows them.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { pageTitle, renderMarkdown } from '../../src/renderer/src/help/markdown';

const ROOT = path.resolve(import.meta.dirname, '../..');
const HELP = path.join(ROOT, 'content/help');
const files = readdirSync(HELP).filter((f) => f.endsWith('.md'));
const read = (f: string) => readFileSync(path.join(HELP, f), 'utf8');
const html = (source: string) => renderToStaticMarkup(createElement('div', null, ...renderMarkdown(source, { onPage: () => {}, onWebLink: () => {} })));

describe('help pages', () => {
  it('are numbered in order, each with its own title', () => {
    expect(files.length).toBeGreaterThanOrEqual(10);
    for (const f of files) {
      expect(f, f).toMatch(/^\d{2}-[a-z-]+\.md$/);
      expect(read(f).startsWith('# '), f).toBe(true);
    }
    const titles = files.map((f) => pageTitle(read(f)));
    expect(new Set(titles).size).toBe(files.length);
  });

  it('link only to help pages that exist', () => {
    for (const f of files) {
      for (const m of read(f).matchAll(/\]\(([^)]+)\)/g)) expect(files, `${f} links to ${m[1]}`).toContain(m[1]);
    }
  });

  it('list every shortcut in the menu', () => {
    const menu = readFileSync(path.join(ROOT, 'src/main/menu.ts'), 'utf8');
    const shortcuts = read('10-shortcuts.md');
    for (const m of menu.matchAll(/accelerator: '([^']+)'/g)) {
      const key = m[1].replace('CmdOrCtrl', 'Ctrl');
      expect(shortcuts, key).toContain(`\`${key}\``);
    }
  });
});

describe('the Markdown reader', () => {
  it('reads headings, paragraphs, bold, keys and links', () => {
    expect(html('# Title\n\nSome **bold** text with `Ctrl+S`\nand a [link](02-reading.md).\n\n## Part')).toBe(
      '<div><h1>Title</h1><p>Some <strong>bold</strong> text with <code>Ctrl+S</code> and a <a href="#02-reading.md">link</a>.</p><h2>Part</h2></div>',
    );
  });

  it('reads lists, with items under items, and numbered lists', () => {
    expect(html('- One\n- Two\n    - Two a\n    - Two b\n\n1. First\n2. Second')).toBe(
      '<div><ul><li>One</li><li>Two<ul><li>Two a</li><li>Two b</li></ul></li></ul><ol><li>First</li><li>Second</li></ol></div>',
    );
  });

  it('reads tables', () => {
    expect(html('| Keys | What |\n|---|---|\n| `F1` | Help |')).toBe(
      '<div><table><thead><tr><th scope="col">Keys</th><th scope="col">What</th></tr></thead><tbody><tr><td><code>F1</code></td><td>Help</td></tr></tbody></table></div>',
    );
  });

  it('shows anything that looks like HTML as plain text, and leaves other links as text', () => {
    expect(html('<script>alert(1)</script> and [a file](C:\\secret.txt)')).toBe('<div><p>&lt;script&gt;alert(1)&lt;/script&gt; and a file</p></div>');
  });
});
