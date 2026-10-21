import { useEffect, useRef } from 'react';
import { pageTitle, renderMarkdown } from '../help/markdown';

// The help pages, from content/help/*.md: edited as plain text, built into the app.
const FILES = import.meta.glob('../../../../content/help/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

export const HELP_PAGES = Object.entries(FILES)
  .map(([path, source]) => ({ file: path.split('/').pop() as string, source, title: pageTitle(source) }))
  .sort((a, b) => a.file.localeCompare(b.file));

/** Help: a list of topics, and the chosen one. */
export function Help({ page, onPage, onWebLink }: { page: string; onPage: (file: string) => void; onWebLink: (address: string) => void }) {
  const current = HELP_PAGES.find((p) => p.file === page) ?? HELP_PAGES[0];
  const article = useRef<HTMLElement>(null);
  useEffect(() => {
    article.current?.scrollTo?.({ top: 0 });
  }, [current?.file]);
  if (!current) return null;
  return (
    <div className="sf-help">
      <nav className="sf-help-topics" aria-label="Help topics">
        <ul>
          {HELP_PAGES.map((p) => (
            <li key={p.file}>
              <button type="button" className="sf-nav-item" aria-current={p.file === current.file ? 'page' : undefined} onClick={() => onPage(p.file)}>
                {p.title}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <article ref={article} className="sf-screen sf-help-page" data-testid="help-page">
        {renderMarkdown(current.source, { onPage, onWebLink })}
      </article>
    </div>
  );
}
