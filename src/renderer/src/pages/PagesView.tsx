import { useCallback, useEffect, useRef, useState, type Dispatch } from 'react';
import type { OpenedFile } from '../../../shared/api';
import { outputName } from '../../../engine/names';
import type { BuildReport, PageItem } from '../../../engine/types';
import { Icon, type IconName } from '../components/Icon';
import { buildDocument } from './engineClient';
import { canRemove, hasChanges, newKey, selectedTiles, type EditAction, type EditState, type Tile } from './editState';
import { engineInput, type ConfirmRequest, type SourceDoc } from './sources';
import { SplitDialog } from './SplitDialog';

const THUMB_BOX = 150;
const DRAG_TYPE = 'application/x-scribeforge-pages';
const api = window.scribeforge;

const fileNameOf = (p: string) => p.split(/[\\/]/).pop() ?? p;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What to tell the person after saving. */
function savedMessage(path: string, report: BuildReport): string {
  const lines = [`Saved ${fileNameOf(path)} (${plural(report.pages, 'page')}).`];
  const removed = report.linksRemoved + report.bookmarksRemoved;
  if (removed > 0) {
    lines.push(
      `${plural(report.linksRemoved, 'link')} and ${plural(report.bookmarksRemoved, 'bookmark')} pointed to pages that aren't in the new file, so they were left out.`,
    );
  }
  if (report.formFieldsDetached > 0) lines.push("Form fields look the same but can't be filled in, in the new file.");
  if (report.actionsRemoved > 0) lines.push('Scripts and other actions in the pages were removed.');
  return lines.join('\n');
}

function describe(tile: Tile, position: number, sources: SourceDoc[]): { label: string; detail: string } {
  const item = tile.item;
  if (item.kind === 'blank') return { label: `Page ${position}, blank`, detail: 'Blank page' };
  const source = sources.find((s) => s.id === item.source);
  const origin = sources.length > 1 ? `${source?.name ?? ''}, page ${item.index + 1}` : item.index + 1 !== position ? `was page ${item.index + 1}` : '';
  const turned = item.rotate ? `turned ${item.rotate}°` : '';
  return { label: [`Page ${position}`, origin, turned].filter(Boolean).join(', '), detail: [origin, turned].filter(Boolean).join(' · ') };
}

/** Draws each page thumbnail as it scrolls into view (two at a time), turned as it will be saved. */
function useThumbnails(grid: React.RefObject<HTMLOListElement | null>, sources: SourceDoc[], tiles: Tile[]) {
  useEffect(() => {
    const root = grid.current;
    if (!root) return;
    const queue: HTMLCanvasElement[] = [];
    let running = 0;
    let stopped = false;
    const pump = () => {
      while (!stopped && running < 2 && queue.length > 0) {
        const canvas = queue.shift() as HTMLCanvasElement;
        const want = canvas.dataset.want as string;
        const source = sources.find((s) => s.id === canvas.dataset.source);
        if (!source) continue;
        running++;
        void source.pdf
          .getPage(Number(canvas.dataset.index) + 1)
          .then(async (page) => {
            const rotation = (page.rotate + Number(canvas.dataset.rotate)) % 360;
            const base = page.getViewport({ scale: 1, rotation });
            const scale = Math.min(THUMB_BOX / base.width, THUMB_BOX / base.height);
            const dpr = window.devicePixelRatio || 1;
            const viewport = page.getViewport({ scale: scale * dpr, rotation });
            canvas.width = Math.round(viewport.width);
            canvas.height = Math.round(viewport.height);
            canvas.style.width = `${Math.round(base.width * scale)}px`;
            canvas.style.height = `${Math.round(base.height * scale)}px`;
            if (!stopped) await page.render({ canvas, viewport }).promise;
            canvas.dataset.rendered = want;
          })
          .catch(() => {
            canvas.dataset.rendered = 'failed';
          })
          .finally(() => {
            running--;
            pump();
          });
      }
    };
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const canvas = entry.target as HTMLCanvasElement;
          if (entry.isIntersecting && canvas.dataset.rendered !== canvas.dataset.want && !queue.includes(canvas)) queue.push(canvas);
        }
        pump();
      },
      { root, rootMargin: '300px 0px' },
    );
    root.querySelectorAll('canvas').forEach((c) => observer.observe(c));
    return () => {
      stopped = true;
      observer.disconnect();
    };
  }, [grid, sources, tiles]);
}

export function PagesView({
  edit,
  dispatch,
  sources,
  saveNow,
  onSaveStarted,
  addFiles,
  confirm,
  onMessage,
  onSaved,
}: {
  edit: EditState;
  dispatch: Dispatch<EditAction>;
  sources: SourceDoc[];
  /** Set when Save was asked for from the menu (Ctrl+S); cleared with onSaveStarted. */
  saveNow: boolean;
  onSaveStarted: () => void;
  /** Loads files (asking for passwords) and registers them as sources. */
  addFiles: (files: OpenedFile[]) => Promise<SourceDoc[]>;
  confirm: (request: ConfirmRequest) => Promise<boolean>;
  onMessage: (text: string) => void;
  onSaved: (path: string) => void;
}) {
  const gridRef = useRef<HTMLOListElement>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [splitting, setSplitting] = useState(false);
  const [drop, setDrop] = useState<{ key: string; side: 'before' | 'after' } | null>(null);
  const primary = sources[0];
  const selected = selectedTiles(edit);
  const dirty = hasChanges(edit);
  useThumbnails(gridRef, sources, edit.tiles);

  const position = (key: string) => edit.tiles.findIndex((t) => t.key === key) + 1;

  // ---- adding pages ----
  const addTiles = useCallback(
    async (files: OpenedFile[]) => {
      if (files.length === 0) return;
      setWorking('Adding pages…');
      try {
        const added = await addFiles(files);
        const tiles: Tile[] = added.flatMap((s) =>
          Array.from({ length: s.pdf.numPages }, (_, i) => ({ key: newKey(s.id), item: { kind: 'page', source: s.id, index: i, rotate: 0 } as PageItem })),
        );
        dispatch({ type: 'add', tiles });
      } finally {
        setWorking(null);
      }
    },
    [addFiles, dispatch],
  );

  const addFromDialog = async () => {
    const results = await api.openMany();
    const failed = results.filter((r) => !r.ok && r.reason !== 'cancelled');
    if (failed.length > 0) onMessage(`${plural(failed.length, 'file')} couldn't be added. Only PDF files that ScribeForge can read can be added.`);
    await addTiles(results.flatMap((r) => (r.ok ? [r.file] : [])));
  };

  const insertBlank = async () => {
    // Same size as the page it follows, as that page will appear.
    const last = selected[selected.length - 1] ?? edit.tiles[edit.tiles.length - 1];
    let width = 612;
    let height = 792;
    if (last?.item.kind === 'blank') ({ width, height } = last.item);
    else if (last?.item.kind === 'page') {
      const item = last.item;
      const source = sources.find((s) => s.id === item.source);
      if (source) {
        const page = await source.pdf.getPage(item.index + 1);
        const vp = page.getViewport({ scale: 1, rotation: (page.rotate + item.rotate) % 360 });
        width = Math.round(vp.width);
        height = Math.round(vp.height);
      }
    }
    dispatch({ type: 'insert-blank', tile: { key: newKey('blank'), item: { kind: 'blank', width, height } } });
  };

  // ---- building and saving ----
  const usedSources = (items: PageItem[]) => sources.filter((s) => items.some((i) => i.kind === 'page' && i.source === s.id));

  const passwordCheck = async (items: PageItem[]): Promise<boolean> => {
    const locked = usedSources(items).filter((s) => s.password);
    if (locked.length === 0) return true;
    return confirm({
      title: "The new file won't have a password",
      message: `${locked.map((s) => s.name).join(', ')} ${locked.length === 1 ? 'is' : 'are'} password-protected. The new file will open without a password.`,
      confirmLabel: 'Save without a password',
    });
  };

  const save = async (which: 'all' | 'selected') => {
    if (working) return;
    const tiles = which === 'all' ? edit.tiles : selected;
    if (tiles.length === 0) return;
    const items = tiles.map((t) => t.item);
    if (!(await passwordCheck(items))) return;
    const used = usedSources(items);
    const name =
      which === 'all' ? outputName(primary.name, used.length > 1 ? 'merged' : 'edited') : outputName(primary.name, { pages: tiles.map((t) => position(t.key)) });
    setWorking('Making the new file…');
    try {
      const { bytes, report } = await buildDocument(used.map(engineInput), items);
      setWorking('Saving…');
      const result = await api.saveFile({ bytes, suggestedName: name, sourcePaths: sources.map((s) => s.path) });
      if (result.ok) {
        onMessage(savedMessage(result.path, report));
        if (which === 'all') onSaved(result.path);
      } else if (result.reason === 'failed') onMessage(result.message ?? "ScribeForge couldn't save the file.");
    } catch (error) {
      onMessage(`ScribeForge couldn't make the new file. ${error instanceof Error ? error.message : ''}`.trim());
    } finally {
      setWorking(null);
    }
  };

  const split = async (parts: number[][]) => {
    setSplitting(false);
    const groups = parts.map((part) => part.map((n) => edit.tiles[n - 1]));
    const items = groups.flat().map((t) => t.item);
    if (!(await passwordCheck(items))) return;
    setWorking('Making the new files…');
    try {
      const files: { name: string; bytes: Uint8Array }[] = [];
      for (const [i, group] of groups.entries()) {
        setWorking(`Making file ${i + 1} of ${groups.length}…`);
        const groupItems = group.map((t) => t.item);
        const { bytes } = await buildDocument(usedSources(groupItems).map(engineInput), groupItems);
        files.push({ name: outputName(primary.name, { pages: parts[i] }), bytes });
      }
      setWorking('Saving…');
      const result = await api.saveFiles({ files, sourcePaths: sources.map((s) => s.path) });
      if (result.ok) onMessage(`Split into ${plural(result.paths.length, 'file')} in ${result.folder}.`);
      else if (result.reason === 'failed') onMessage(result.message ?? "ScribeForge couldn't save the files.");
    } catch (error) {
      onMessage(`ScribeForge couldn't make the new files. ${error instanceof Error ? error.message : ''}`.trim());
    } finally {
      setWorking(null);
    }
  };

  const remove = () => {
    if (!canRemove(edit)) {
      onMessage(edit.selected.length === 0 ? 'Select the pages to delete first.' : 'A PDF needs at least one page, so the last page can\'t be deleted.');
      return;
    }
    dispatch({ type: 'remove' });
  };

  // ---- keyboard ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('input, textarea, select, .sf-dialog') || document.querySelector('.sf-dialog')) return;
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key.toLowerCase() === 'z') dispatch({ type: 'undo' });
      else if (ctrl && e.key.toLowerCase() === 'y') dispatch({ type: 'redo' });
      else if (ctrl && e.key.toLowerCase() === 'a' && target.closest('.sf-page-grid')) dispatch({ type: 'select-all' });
      else if (e.key === 'Delete' && target.closest('.sf-page-grid')) remove();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const onTileKey = (e: React.KeyboardEvent, index: number) => {
    const tile = edit.tiles[index];
    const columns = Math.max(1, Math.round((gridRef.current?.clientWidth ?? 600) / ((gridRef.current?.firstElementChild as HTMLElement | null)?.offsetWidth ?? 190)));
    const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns, Home: -index, End: edit.tiles.length - 1 - index };
    if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      if (!edit.selected.includes(tile.key)) dispatch({ type: 'select', key: tile.key, mode: 'only' });
      dispatch({ type: 'shift', by: e.key === 'ArrowLeft' ? -1 : 1 });
      return;
    }
    if (step[e.key] !== undefined) {
      e.preventDefault();
      const next = edit.tiles[Math.min(edit.tiles.length - 1, Math.max(0, index + step[e.key]))];
      setFocusKey(next.key);
      if (e.shiftKey) dispatch({ type: 'select', key: next.key, mode: 'range' });
      (gridRef.current?.querySelector(`[data-key="${CSS.escape(next.key)}"]`) as HTMLElement | null)?.focus();
    } else if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      dispatch({ type: 'select', key: tile.key, mode: e.key === ' ' || e.ctrlKey ? 'toggle' : 'only' });
    }
  };

  // ---- File > Save as new file (Ctrl+S) ----
  // The ref makes sure one request starts one save, even when React runs this twice.
  const saveStarted = useRef(false);
  useEffect(() => {
    if (!saveNow) {
      saveStarted.current = false;
      return;
    }
    if (saveStarted.current) return;
    saveStarted.current = true;
    onSaveStarted();
    void save('all');
  });

  // ---- dragging ----
  const onDragStart = (e: React.DragEvent, tile: Tile) => {
    const keys = edit.selected.includes(tile.key) ? edit.selected : [tile.key];
    if (!edit.selected.includes(tile.key)) dispatch({ type: 'select', key: tile.key, mode: 'only' });
    e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(keys));
    e.dataTransfer.effectAllowed = 'move';
  };
  const onDragOver = (e: React.DragEvent, tile: Tile) => {
    if (e.dataTransfer.types.includes(DRAG_TYPE)) {
      e.preventDefault();
      e.stopPropagation();
      const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const side = e.clientX < box.left + box.width / 2 ? 'before' : 'after';
      if (drop?.key !== tile.key || drop.side !== side) setDrop({ key: tile.key, side });
    } else if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault();
      e.stopPropagation();
    }
  };
  const onDrop = (e: React.DragEvent, tile: Tile | null) => {
    e.preventDefault();
    e.stopPropagation();
    setDrop(null);
    const raw = e.dataTransfer.getData(DRAG_TYPE);
    if (raw) {
      const keys = JSON.parse(raw) as string[];
      const index = tile ? edit.tiles.findIndex((t) => t.key === tile.key) : edit.tiles.length;
      const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const after = tile ? e.clientX >= box.left + box.width / 2 : false;
      dispatch({ type: 'move', keys, to: after ? index + 1 : index });
      return;
    }
    // PDF files dragged in from a folder are added to the document.
    const paths = [...e.dataTransfer.files].map((f) => api.pathForFile(f)).filter(Boolean);
    void (async () => {
      const opened = await Promise.all(paths.map((p) => api.openPath(p)));
      const refused = opened.filter((r) => !r.ok).length;
      if (refused > 0) onMessage(`${plural(refused, 'item')} couldn't be added. Only PDF files can be added.`);
      await addTiles(opened.flatMap((r) => (r.ok ? [r.file] : [])));
    })();
  };

  const tool = (icon: IconName, label: string, onClick: () => void, disabled = false, primaryStyle = false) => (
    <button type="button" className={primaryStyle ? 'sf-button sf-primary' : 'sf-tool'} onClick={onClick} disabled={disabled || working !== null} title={label}>
      <Icon name={icon} size={18} />
      <span>{label}</span>
    </button>
  );

  const none = selected.length === 0;
  return (
    <div className="sf-pages">
      <div className="sf-toolbar sf-pages-toolbar" role="toolbar" aria-label="Pages">
        {tool('add', 'Add files…', () => void addFromDialog())}
        {tool('blank', 'Insert blank page', () => void insertBlank())}
        <span className="sf-toolbar-gap" />
        {tool('rotate-left', 'Rotate left', () => dispatch({ type: 'rotate', by: 270 }), none)}
        {tool('rotate-right', 'Rotate right', () => dispatch({ type: 'rotate', by: 90 }), none)}
        {tool('previous', 'Move earlier', () => dispatch({ type: 'shift', by: -1 }), none)}
        {tool('next', 'Move later', () => dispatch({ type: 'shift', by: 1 }), none)}
        {tool('delete', 'Delete', remove, none)}
        <span className="sf-toolbar-gap" />
        {tool('undo', 'Undo', () => dispatch({ type: 'undo' }), edit.past.length === 0)}
        {tool('redo', 'Redo', () => dispatch({ type: 'redo' }), edit.future.length === 0)}
        <span className="sf-toolbar-gap" />
        {tool('extract', 'Save selected pages…', () => void save('selected'), none)}
        {tool('split', 'Split…', () => setSplitting(true), edit.tiles.length < 2)}
        <span className="sf-toolbar-fill" />
        {tool('save', 'Save as new file…', () => void save('all'), false, true)}
      </div>
      <p className="sf-pages-status" data-testid="pages-status" aria-live="polite">
        {working ?? [plural(edit.tiles.length, 'page'), `${selected.length} selected`, dirty ? 'Changes not saved yet' : 'No changes'].join(' · ')}
      </p>
      <ol
        ref={gridRef}
        className="sf-page-grid"
        role="listbox"
        aria-multiselectable="true"
        aria-label="Pages, in order"
        data-testid="page-grid"
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes(DRAG_TYPE) || e.dataTransfer.types.includes('Files')) {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
        onDrop={(e) => onDrop(e, null)}
        onDragLeave={() => setDrop(null)}
      >
        {edit.tiles.map((tile, i) => {
          const { label, detail } = describe(tile, i + 1, sources);
          const isSelected = edit.selected.includes(tile.key);
          const item = tile.item;
          return (
            <li
              key={tile.key}
              data-key={tile.key}
              role="option"
              aria-selected={isSelected}
              aria-label={label}
              tabIndex={(focusKey ?? edit.tiles[0]?.key) === tile.key ? 0 : -1}
              className="sf-page-tile"
              data-drop={drop?.key === tile.key ? drop.side : undefined}
              draggable={working === null}
              onClick={(e) => {
                setFocusKey(tile.key);
                dispatch({ type: 'select', key: tile.key, mode: e.shiftKey ? 'range' : e.ctrlKey || e.metaKey ? 'toggle' : 'only' });
              }}
              onKeyDown={(e) => onTileKey(e, i)}
              onFocus={() => setFocusKey(tile.key)}
              onDragStart={(e) => onDragStart(e, tile)}
              onDragOver={(e) => onDragOver(e, tile)}
              onDrop={(e) => onDrop(e, tile)}
              onDragEnd={() => setDrop(null)}
            >
              <span className="sf-page-frame">
                {item.kind === 'page' ? (
                  <canvas
                    data-source={item.source}
                    data-index={item.index}
                    data-rotate={item.rotate}
                    data-want={`${item.source}:${item.index}:${item.rotate}`}
                    className="sf-page-canvas"
                  />
                ) : (
                  <span
                    className="sf-page-blank"
                    style={{
                      width: `${Math.round((THUMB_BOX * item.width) / Math.max(item.width, item.height))}px`,
                      height: `${Math.round((THUMB_BOX * item.height) / Math.max(item.width, item.height))}px`,
                    }}
                  />
                )}
              </span>
              <span className="sf-page-number">{i + 1}</span>
              {detail && <span className="sf-page-detail">{detail}</span>}
            </li>
          );
        })}
      </ol>
      {splitting && <SplitDialog pageCount={edit.tiles.length} onSplit={(parts) => void split(parts)} onCancel={() => setSplitting(false)} />}
    </div>
  );
}
