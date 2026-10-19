import { useCallback, useEffect, useRef, useState, type Dispatch } from 'react';
import type { OpenedFile } from '../../../shared/api';
import type { PageItem } from '../../../engine/types';
import { Icon, type IconName } from '../components/Icon';
import { canRemove, newKey, selectedTiles, type EditAction, type EditState, type Tile } from './editState';
import { plural } from './saving';
import type { SourceDoc } from './sources';
import { SplitDialog } from './SplitDialog';

const THUMB_BOX = 150;
const DRAG_TYPE = 'application/x-scribeforge-pages';
const api = window.scribeforge;

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
  unsaved,
  working,
  onSaveAll,
  onSaveSelected,
  onSplit,
  addFiles,
  onMessage,
}: {
  edit: EditState;
  dispatch: Dispatch<EditAction>;
  sources: SourceDoc[];
  /** Page changes or annotations not saved yet. */
  unsaved: boolean;
  /** What's being saved right now, if anything. */
  working: string | null;
  onSaveAll: () => void;
  onSaveSelected: (tiles: Tile[]) => void;
  onSplit: (parts: number[][]) => void;
  /** Loads files (asking for passwords) and registers them as sources. */
  addFiles: (files: OpenedFile[]) => Promise<SourceDoc[]>;
  onMessage: (text: string) => void;
}) {
  const gridRef = useRef<HTMLOListElement>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [splitting, setSplitting] = useState(false);
  const [drop, setDrop] = useState<{ key: string; side: 'before' | 'after' } | null>(null);
  const selected = selectedTiles(edit);
  useThumbnails(gridRef, sources, edit.tiles);

  // ---- adding pages ----
  const addTiles = useCallback(
    async (files: OpenedFile[]) => {
      if (files.length === 0) return;
      setAdding(true);
      try {
        const added = await addFiles(files);
        const tiles: Tile[] = added.flatMap((s) =>
          Array.from({ length: s.pdf.numPages }, (_, i) => ({ key: newKey(s.id), item: { kind: 'page', source: s.id, index: i, rotate: 0 } as PageItem })),
        );
        dispatch({ type: 'add', tiles });
      } finally {
        setAdding(false);
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
    <button type="button" className={primaryStyle ? 'sf-button sf-primary' : 'sf-tool'} onClick={onClick} disabled={disabled || busy} title={label}>
      <Icon name={icon} size={18} />
      <span>{label}</span>
    </button>
  );

  const none = selected.length === 0;
  const busy = working !== null || adding;
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
        {tool('extract', 'Save selected pages…', () => onSaveSelected(selected), none)}
        {tool('split', 'Split…', () => setSplitting(true), edit.tiles.length < 2)}
        <span className="sf-toolbar-fill" />
        {tool('save', 'Save as new file…', onSaveAll, false, true)}
      </div>
      <p className="sf-pages-status" data-testid="pages-status" aria-live="polite">
        {working ?? (adding ? 'Adding pages…' : [plural(edit.tiles.length, 'page'), `${selected.length} selected`, unsaved ? 'Changes not saved yet' : 'No changes'].join(' · '))}
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
              draggable={!busy}
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
      {splitting && (
        <SplitDialog
          pageCount={edit.tiles.length}
          onSplit={(parts) => {
            setSplitting(false);
            onSplit(parts);
          }}
          onCancel={() => setSplitting(false)}
        />
      )}
    </div>
  );
}
