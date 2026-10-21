import { useMemo, useState } from 'react';
import { Icon } from '../components/Icon';
import { formatDate } from '../details/describe';
import { plural } from '../words';
import { ANNOT_NAMES, type Annot } from './annotState';
import { fileKindName, type FileAnnot } from './fileAnnots';

/** One annotation as the comments panel lists it. */
export interface CommentEntry {
  /** An annotation's id, or "file:<id>" for one already in the file. */
  key: string;
  page: number;
  kind: string;
  author: string;
  text: string;
  date: string;
  replies: number;
  /** Changed here, not saved yet. */
  changed: boolean;
}

/** Every annotation, old and new, as the panel lists them: by page, replies counted under what they answer. */
export function commentEntries(annots: Annot[], files: FileAnnot[], edits: Record<string, { deleted?: boolean; text?: string; colourId?: string; flatten?: boolean }>, authorName: string): CommentEntry[] {
  const you = authorName || 'You';
  const replyCount = new Map<string, number>();
  const count = (key: string) => replyCount.set(key, (replyCount.get(key) ?? 0) + 1);
  // Replies to replies count towards the comment at the top of the thread.
  const fileParent = new Map(files.map((f) => [f.id, f.inReplyTo]));
  const topOf = (id: string): string => {
    let at = id;
    for (let i = 0; i < 50 && fileParent.get(at); i++) at = fileParent.get(at) as string;
    return at;
  };
  for (const f of files) if (f.inReplyTo && !edits[f.id]?.deleted) count(`file:${topOf(f.inReplyTo)}`);
  const addedParent = new Map(annots.map((a) => [a.id, a.replyTo]));
  for (const a of annots) {
    if (a.kind !== 'reply' || !a.replyTo) continue;
    let at = a.replyTo;
    for (let i = 0; i < 50 && addedParent.get(at); i++) at = addedParent.get(at) as string;
    if (at.startsWith('file:')) at = `file:${topOf(at.slice(5))}`;
    count(at);
  }

  const entries: CommentEntry[] = [];
  for (const f of files) {
    const edit = edits[f.id];
    if (f.inReplyTo || edit?.deleted) continue;
    entries.push({
      key: `file:${f.id}`,
      page: f.page,
      kind: fileKindName(f),
      author: f.author,
      text: edit?.text ?? f.contents,
      date: f.modified,
      replies: replyCount.get(`file:${f.id}`) ?? 0,
      changed: !!edit && Object.keys(edit).length > 0,
    });
  }
  for (const a of annots) {
    if (a.kind === 'reply') continue;
    entries.push({
      key: a.id,
      page: a.page,
      kind: ANNOT_NAMES[a.kind],
      author: you,
      text: a.text || a.label || '',
      date: a.createdAt,
      replies: replyCount.get(a.id) ?? 0,
      changed: true,
    });
  }
  return entries.sort((x, y) => x.page - y.page);
}

/**
 * Every annotation in the document, old and new, by page, with its author and text. Filter by
 * who made it or what kind it is, and click one to go to it.
 */
export function CommentsPanel({
  entries,
  loading,
  selected,
  flattenAll,
  onOpen,
  onFlattenAll,
  onClose,
}: {
  entries: CommentEntry[];
  /** Still reading the file's own annotations: "page n of m". */
  loading: string | null;
  selected: string | null;
  flattenAll: boolean;
  onOpen: (entry: CommentEntry) => void;
  onFlattenAll: (on: boolean) => void;
  onClose: () => void;
}) {
  const [author, setAuthor] = useState('');
  const [kind, setKind] = useState('');
  const authors = useMemo(() => [...new Set(entries.map((e) => e.author || 'No name'))].sort(), [entries]);
  const kinds = useMemo(() => [...new Set(entries.map((e) => e.kind))].sort(), [entries]);
  const shown = entries.filter((e) => (!author || (e.author || 'No name') === author) && (!kind || e.kind === kind));
  const pages = [...new Set(shown.map((e) => e.page))];

  return (
    <aside className="sf-comments" aria-label="Comments" data-testid="comments-panel">
      <div className="sf-annot-panel-head">
        <h2>Comments</h2>
        <button type="button" className="sf-icon-button" aria-label="Close comments" onClick={onClose}>
          <Icon name="close" size={18} />
        </button>
      </div>
      <div className="sf-comments-filters">
        <label className="sf-field">
          <span>Who</span>
          <select value={author} onChange={(e) => setAuthor(e.target.value)}>
            <option value="">Everyone</option>
            {authors.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <label className="sf-field">
          <span>Kind</span>
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">All kinds</option>
            {kinds.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="sf-muted" data-testid="comments-count" aria-live="polite">
        {loading ?? (entries.length === 0 ? 'No annotations yet.' : shown.length === entries.length ? plural(entries.length, 'annotation') : `${shown.length} of ${plural(entries.length, 'annotation')}`)}
      </p>
      <div className="sf-comments-list">
        {pages.map((page) => (
          <section key={page}>
            <h3>Page {page + 1}</h3>
            <ul>
              {shown
                .filter((e) => e.page === page)
                .map((e) => (
                  <li key={e.key}>
                    <button type="button" className="sf-comment" aria-current={e.key === selected ? 'true' : undefined} data-entry={e.key} onClick={() => onOpen(e)}>
                      <span className="sf-comment-head">
                        <span className="sf-strong">{e.kind}</span>
                        <span className="sf-muted">{[e.author, e.changed ? 'not saved yet' : formatDate(e.date)].filter(Boolean).join(', ')}</span>
                      </span>
                      {e.text && <span className="sf-comment-text">{e.text}</span>}
                      {e.replies > 0 && <span className="sf-muted">{plural(e.replies, 'reply', 'replies')}</span>}
                    </button>
                  </li>
                ))}
            </ul>
          </section>
        ))}
      </div>
      <label className="sf-choice sf-comments-burn">
        <input type="checkbox" checked={flattenAll} onChange={(e) => onFlattenAll(e.target.checked)} />
        <span>When saving, burn all annotations into the pages</span>
      </label>
      <p className="sf-muted sf-comments-burn-hint">They keep their look, but can't be changed or removed, and their comments and replies aren't kept.</p>
    </aside>
  );
}
