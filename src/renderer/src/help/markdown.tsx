// A small Markdown reader for the help pages (content/help/*.md): headings, paragraphs, lists,
// tables, **bold**, `keys and names`, and links. It builds React elements, never HTML, so
// nothing in a help page can run as code. Links to another help page (`other-page.md`) open it;
// web links go to `onWebLink`, which asks before opening them in the browser.
import type { ReactNode } from 'react';

export interface Links {
  onPage: (file: string) => void;
  onWebLink: (address: string) => void;
}

/** **bold**, `code`, and [text](target) within a line. */
export function inline(text: string, links: Links, key = 'i'): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  let n = 0;
  for (const m of text.matchAll(pattern)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${key}-${n++}`;
    if (m[1] !== undefined) out.push(<strong key={k}>{inline(m[1], links, k)}</strong>);
    else if (m[2] !== undefined) out.push(<code key={k}>{m[2]}</code>);
    else {
      const [label, target] = [m[3], m[4]];
      if (/^[\w-]+\.md$/.test(target)) {
        out.push(
          <a
            key={k}
            href={`#${target}`}
            onClick={(e) => {
              e.preventDefault();
              links.onPage(target);
            }}
          >
            {label}
          </a>,
        );
      } else if (/^(https?:|mailto:)/i.test(target)) {
        out.push(
          <a
            key={k}
            href={target}
            onClick={(e) => {
              e.preventDefault();
              links.onWebLink(target);
            }}
          >
            {label}
          </a>,
        );
      } else out.push(label);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const cells = (row: string) =>
  row
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());

/** A help page as React elements. */
export function renderMarkdown(source: string, links: Links): ReactNode[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  const key = () => `b${blocks.length}`;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') {
      i++;
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const content = inline(heading[2], links, key());
      blocks.push(level === 1 ? <h1 key={key()}>{content}</h1> : level === 2 ? <h2 key={key()}>{content}</h2> : <h3 key={key()}>{content}</h3>);
      i++;
      continue;
    }
    if (line.trim().startsWith('|')) {
      const rows: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(lines[i++]);
      const [head, , ...body] = rows;
      const k = key();
      blocks.push(
        <table key={k}>
          <thead>
            <tr>
              {cells(head).map((c, j) => (
                <th key={j} scope="col">
                  {inline(c, links, `${k}h${j}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.map((row, r) => (
              <tr key={r}>
                {cells(row).map((c, j) => (
                  <td key={j}>{inline(c, links, `${k}r${r}c${j}`)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>,
      );
      continue;
    }
    const listItem = /^(\s*)(-|\d+\.)\s+(.*)$/;
    if (listItem.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: { text: string; more: string[] }[] = [];
      while (i < lines.length && (listItem.test(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && items.length > 0) || (lines[i].trim() === '' && /^\s{2,}\S/.test(lines[i + 1] ?? '')))) {
        const m = listItem.exec(lines[i]);
        if (m && m[1].length < 2) items.push({ text: m[3], more: [] });
        else if (lines[i].trim() !== '') items[items.length - 1].more.push(lines[i].trim());
        i++;
      }
      const k = key();
      const children = items.map((item, j) => {
        const sub = item.more.filter((t) => /^(-|\d+\.)\s+/.test(t)).map((t) => t.replace(/^(-|\d+\.)\s+/, ''));
        const extra = item.more.filter((t) => !/^(-|\d+\.)\s+/.test(t)).join(' ');
        return (
          <li key={j}>
            {inline(item.text, links, `${k}l${j}`)}
            {sub.length > 0 && (
              <ul>
                {sub.map((t, s) => (
                  <li key={s}>{inline(t, links, `${k}l${j}s${s}`)}</li>
                ))}
              </ul>
            )}
            {extra && <p>{inline(extra, links, `${k}l${j}p`)}</p>}
          </li>
        );
      });
      blocks.push(ordered ? <ol key={k}>{children}</ol> : <ul key={k}>{children}</ul>);
      continue;
    }
    // A paragraph: lines up to the next blank line or block.
    const text: string[] = [];
    while (i < lines.length && lines[i].trim() !== '' && !/^(#{1,3}\s|\s*\||\s*(-|\d+\.)\s)/.test(lines[i])) text.push(lines[i++].trim());
    const k = key();
    blocks.push(<p key={k}>{inline(text.join(' '), links, k)}</p>);
  }
  return blocks;
}

/** A help page's title: its first heading. */
export function pageTitle(source: string): string {
  return /^#\s+(.+)$/m.exec(source)?.[1].trim() ?? '';
}
