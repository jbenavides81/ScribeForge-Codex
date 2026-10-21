import './pdfjs';
import { useCallback, useEffect, useRef, useState, type Dispatch } from 'react';
import { EventBus, PDFFindController, PDFLinkService, PDFViewer } from 'pdfjs-dist/web/pdf_viewer.mjs';
import type { MenuCommand } from '../../../shared/api';
import { isOpenableLink } from '../../../shared/links';
import { DEFAULT_ANNOTATION_COLOUR } from '../../../shared/annotationColours';
import { AnnotateToolbar, type Tool } from '../annotate/AnnotateToolbar';
import { AnnotationLayer } from '../annotate/AnnotationLayer';
import { AnnotationPanel } from '../annotate/AnnotationPanel';
import { newAnnotId, TEXT_BOX_POINTS, type Annot, type AnnotAction, type AnnotState } from '../annotate/annotState';
import { boxAt, selectionQuads, type Box } from '../annotate/geometry';
import { Icon } from '../components/Icon';
import type { Rect } from '../../../engine/types';
import { findTerm, glyphsIn, lineBoxes, PADDING, pageGlyphs, type Glyph } from '../redact/glyphs';
import { MarkPanel } from '../redact/MarkPanel';
import { RedactionLayer, type DragBox } from '../redact/RedactionLayer';
import { newMarkId, type RedactAction, type RedactMark, type RedactState } from '../redact/redactState';
import { ModeSwitch, RedactToolbar, type RedactTool } from '../redact/RedactToolbar';
import { plural } from '../words';
import { PDFJS_ASSETS, pdfjsLib, type PdfDocument } from './pdfjs';
import { Thumbnails } from './Thumbnails';

const ZOOM_CHOICES: { value: string; label: string }[] = [
  { value: 'page-width', label: 'Fit width' },
  { value: 'page-fit', label: 'Fit page' },
  { value: '0.5', label: '50%' },
  { value: '0.75', label: '75%' },
  { value: '1', label: '100%' },
  { value: '1.25', label: '125%' },
  { value: '1.5', label: '150%' },
  { value: '2', label: '200%' },
  { value: '3', label: '300%' },
];

interface FindStatus {
  current: number;
  total: number;
  notFound: boolean;
}

export function DocumentView({
  pdf,
  name,
  changed,
  command,
  annots,
  annotDispatch,
  redact,
  redactDispatch,
  onRedact,
  active,
  working,
  onSave,
  onAskLink,
  onRefusedLink,
  onClose,
}: {
  pdf: PdfDocument;
  name: string;
  /** Page changes not saved yet (made on the Pages screen). */
  changed: boolean;
  /** A menu command for this screen, with a counter so repeats still arrive. */
  command: { name: MenuCommand; seq: number } | null;
  /** Annotations added in ScribeForge, not saved yet. */
  annots: AnnotState;
  annotDispatch: Dispatch<AnnotAction>;
  /** Redaction marks, not applied yet. */
  redact: RedactState;
  redactDispatch: Dispatch<RedactAction>;
  /** Review the marks, then make the redacted file. */
  onRedact: () => void;
  /** True while this screen is the one showing (keyboard shortcuts only work then). */
  active: boolean;
  working: string | null;
  onSave: () => void;
  onAskLink: (address: string) => void;
  onRefusedLink: (address: string) => void;
  onClose: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<PDFViewer | null>(null);
  const busRef = useRef<EventBus | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [page, setPage] = useState(1);
  const [pageInput, setPageInput] = useState('1');
  const [zoom, setZoom] = useState({ value: 'page-width', percent: 100 });
  const [showThumbs, setShowThumbs] = useState(true);
  const [query, setQuery] = useState('');
  const [find, setFind] = useState<FindStatus | null>(null);
  const [tool, setTool] = useState<Tool>('select');
  const [colourId, setColourId] = useState(DEFAULT_ANNOTATION_COLOUR);
  const [layout, setLayout] = useState(0);
  const [justPlaced, setJustPlaced] = useState<string | null>(null);
  const [mode, setMode] = useState<'annotate' | 'redact'>('annotate');
  const [redactTool, setRedactTool] = useState<RedactTool>('select');
  const [drag, setDrag] = useState<DragBox | null>(null);
  const [finding, setFinding] = useState(false);
  const [findResult, setFindResult] = useState<string | null>(null);
  const glyphCache = useRef(new Map<number, Promise<Glyph[]>>());
  const relayout = useCallback(() => setLayout((n) => n + 1), []);
  const redacting = mode === 'redact';
  // Typing goes straight into a note or text box just placed, but not when it's selected again later.
  useEffect(() => {
    if (annots.selected !== justPlaced) setJustPlaced(null);
  }, [annots.selected, justPlaced]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const eventBus = new EventBus();
    const linkService = new PDFLinkService({ eventBus });
    const findController = new PDFFindController({ eventBus, linkService });
    const viewer = new PDFViewer({
      container,
      eventBus,
      linkService,
      findController,
      removePageBorders: true,
      textLayerMode: 1,
      annotationMode: pdfjsLib.AnnotationMode.ENABLE,
      annotationEditorMode: pdfjsLib.AnnotationEditorType.DISABLE,
      enableAutoLinking: false,
      imageResourcesPath: `${PDFJS_ASSETS}images/`,
    });
    linkService.setViewer(viewer);
    eventBus.on('pagesinit', () => {
      viewer.currentScaleValue = 'page-width';
      container.dataset.ready = 'true';
    });
    eventBus.on('pagechanging', ({ pageNumber }: { pageNumber: number }) => {
      setPage(pageNumber);
      setPageInput(String(pageNumber));
    });
    eventBus.on('scalechanging', ({ scale, presetValue }: { scale: number; presetValue?: string }) => {
      setZoom({ value: presetValue ?? String(scale), percent: Math.round(scale * 100) });
    });
    eventBus.on('updatefindmatchescount', ({ matchesCount }: { matchesCount: { current: number; total: number } }) => {
      setFind((f) => ({ current: matchesCount.current, total: matchesCount.total, notFound: f?.notFound ?? false }));
    });
    eventBus.on(
      'updatefindcontrolstate',
      ({ state, matchesCount }: { state: number; matchesCount: { current: number; total: number } }) => {
        setFind({ current: matchesCount.current, total: matchesCount.total, notFound: state === 1 });
      },
    );
    for (const event of ['pagesinit', 'pagesloaded', 'pagerendered', 'scalechanging', 'rotationchanging']) eventBus.on(event, relayout);
    const resized = new ResizeObserver(relayout);
    resized.observe(container);
    viewer.setDocument(pdf);
    linkService.setDocument(pdf, null);
    viewerRef.current = viewer;
    busRef.current = eventBus;
    return () => {
      resized.disconnect();
      viewerRef.current = null;
      busRef.current = null;
      // Clear this viewer's pages completely, so nothing of this document is left behind.
      viewer.setDocument(null);
      linkService.setDocument(null);
      delete container.dataset.ready;
    };
  }, [pdf, relayout]);

  const goTo = useCallback(
    (n: number) => {
      const viewer = viewerRef.current;
      if (!viewer) return;
      viewer.currentPageNumber = Math.min(Math.max(1, Math.round(n)), pdf.numPages);
    },
    [pdf],
  );

  const setZoomValue = (value: string) => {
    if (viewerRef.current) viewerRef.current.currentScaleValue = value;
  };

  const runFind = useCallback((text: string, again: boolean, previous = false) => {
    busRef.current?.dispatch('find', {
      source: null,
      type: again ? 'again' : '',
      query: text,
      caseSensitive: false,
      entireWord: false,
      highlightAll: true,
      findPrevious: previous,
      matchDiacritics: false,
    });
    if (!text) setFind(null);
  }, []);

  // Search as you type, after a short pause.
  useEffect(() => {
    const t = window.setTimeout(() => runFind(query, false), 250);
    return () => window.clearTimeout(t);
  }, [query, runFind]);

  useEffect(() => {
    if (!command) return;
    const viewer = viewerRef.current;
    switch (command.name) {
      case 'zoom-in':
        viewer?.increaseScale();
        break;
      case 'zoom-out':
        viewer?.decreaseScale();
        break;
      case 'zoom-fit-width':
        setZoomValue('page-width');
        break;
      case 'zoom-fit-page':
        setZoomValue('page-fit');
        break;
      case 'find':
        searchRef.current?.focus();
        searchRef.current?.select();
        break;
      case 'toggle-thumbnails':
        setShowThumbs((s) => !s);
        break;
      default:
        break;
    }
  }, [command]);

  /** The page under a point on screen, with its pdf.js view. */
  const pageAt = (target: Element | null) => {
    const div = target?.closest('.page') as HTMLElement | null;
    const n = Number(div?.dataset.pageNumber);
    const view = n ? viewerRef.current?.getPageView(n - 1) : null;
    return div && view?.viewport ? { div, index: n - 1, view } : null;
  };

  const add = (annot: Omit<Annot, 'id' | 'colourId' | 'createdAt'>) => {
    const id = newAnnotId();
    annotDispatch({ type: 'add', annot: { ...annot, id, colourId, createdAt: new Date().toISOString() } });
    return id;
  };

  /** Where every letter on a page is (worked out once per page, when first needed). */
  const glyphsOf = (index: number): Promise<Glyph[]> => {
    let glyphs = glyphCache.current.get(index);
    if (!glyphs) {
      glyphs = pdf.getPage(index + 1).then((p) => pageGlyphs(p, { OPS: pdfjsLib.OPS, annotationsOff: pdfjsLib.AnnotationMode.DISABLE }));
      glyphCache.current.set(index, glyphs);
    }
    return glyphs;
  };

  /** The current text selection, as boxes on each page it touches (pixels on the page). */
  const selectionByPage = () => {
    const selection = window.getSelection();
    const byPage = new Map<number, { boxes: Box[]; page: NonNullable<ReturnType<typeof pageAt>> }>();
    if (!selection || selection.isCollapsed) return byPage;
    // Each piece of the selection belongs to the page it sits on, found by position rather than
    // by what's under it on screen, so text scrolled out of view (or off a wide page) still counts.
    const pages = [...(containerRef.current?.querySelectorAll<HTMLElement>('.page') ?? [])].map((div) => ({ div, box: div.getBoundingClientRect() }));
    for (let i = 0; i < selection.rangeCount; i++) {
      for (const r of selection.getRangeAt(i).getClientRects()) {
        const x = r.left + r.width / 2;
        const y = r.top + r.height / 2;
        const hit = pages.find(({ box }) => x >= box.left && x <= box.right && y >= box.top && y <= box.bottom);
        const page = pageAt(hit?.div ?? null);
        if (!page) continue;
        const origin = page.div.getBoundingClientRect();
        const entry = byPage.get(page.index) ?? { boxes: [], page };
        entry.boxes.push({ left: r.left - origin.left, top: r.top - origin.top, right: r.right - origin.left, bottom: r.bottom - origin.top });
        byPage.set(page.index, entry);
      }
    }
    return byPage;
  };

  /** Mark text: covers exactly the letters selected (found by position, not by eye). */
  const redactSelection = async () => {
    const byPage = selectionByPage();
    window.getSelection()?.removeAllRanges();
    const marks: RedactMark[] = [];
    for (const [index, { boxes, page }] of byPage) {
      const lines: Rect[] = selectionQuads(boxes, page.view.viewport).map((q) => [q[4], q[5], q[2], q[3]]);
      const letters = glyphsIn(await glyphsOf(index), lines);
      const rects = letters.length > 0 ? lineBoxes(letters) : lines.map(([a, b, c, d]): Rect => [a - PADDING, b - PADDING, c + PADDING, d + PADDING]);
      if (rects.length > 0) marks.push({ id: newMarkId(), page: index, kind: 'text', rects, text: letters.map((g) => g.text).join('') });
    }
    redactDispatch({ type: 'add', marks });
  };

  /** Find and mark: every match of a term, on every page, becomes a mark. */
  const findAndMark = async (term: string) => {
    setFinding(true);
    const needle = term.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
    const found: { page: number; text: string; boxes: Rect[] }[] = [];
    try {
      for (let index = 0; index < pdf.numPages; index++) {
        if (index % 25 === 0) setFindResult(`Searching page ${index + 1} of ${pdf.numPages}…`);
        // Quick check of the page's text first; letter positions only for pages with a match.
        const content = await (await pdf.getPage(index + 1)).getTextContent();
        const text = content.items.map((i) => ('str' in i ? i.str : '')).join('').normalize('NFKC').toLowerCase().replace(/\s+/g, '');
        if (!text.includes(needle)) continue;
        for (const match of findTerm(await glyphsOf(index), term)) found.push({ page: index, ...match });
      }
      const group = newMarkId();
      redactDispatch({
        type: 'add',
        marks: found.map((f) => ({ id: newMarkId(), page: f.page, kind: 'search', rects: f.boxes, text: f.text, term, group, groupSize: found.length })),
      });
      const pages = new Set(found.map((f) => f.page)).size;
      setFindResult(found.length > 0 ? `Marked ${plural(found.length, 'match', 'matches')} on ${plural(pages, 'page')}.` : `“${term}” wasn't found.`);
    } finally {
      setFinding(false);
    }
  };

  /** Mark area: drag a box across part of a page. */
  const startArea = (e: React.MouseEvent) => {
    if (!redacting || redactTool !== 'area' || e.button !== 0) return;
    const page = pageAt(e.target as Element);
    if (!page) return;
    e.preventDefault();
    const origin = page.div.getBoundingClientRect();
    const sx = e.clientX - origin.left;
    const sy = e.clientY - origin.top;
    const clamp = (v: number, max: number) => Math.min(Math.max(v, 0), max);
    const boxFor = (ev: MouseEvent): DragBox => {
      const now = page.div.getBoundingClientRect();
      const x = clamp(ev.clientX - now.left, now.width);
      const y = clamp(ev.clientY - now.top, now.height);
      return { page: page.index, left: Math.min(sx, x), top: Math.min(sy, y), right: Math.max(sx, x), bottom: Math.max(sy, y) };
    };
    const move = (ev: MouseEvent) => setDrag(boxFor(ev));
    const up = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      setDrag(null);
      const box = boxFor(ev);
      if (box.right - box.left < 4 || box.bottom - box.top < 4) return;
      const vp = page.view.viewport;
      const a = vp.convertToPdfPoint(box.left, box.top);
      const b = vp.convertToPdfPoint(box.right, box.bottom);
      const rect: Rect = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
      redactDispatch({ type: 'add', marks: [{ id: newMarkId(), page: page.index, kind: 'area', rects: [rect] }] });
    };
    setDrag(boxFor(e.nativeEvent));
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  /** Highlight, underline or strikeout: made from the text selected on the page. */
  const markSelection = () => {
    if (redacting) {
      if (redactTool === 'text') void redactSelection();
      return;
    }
    if (tool !== 'highlight' && tool !== 'underline' && tool !== 'strikeout') return;
    const byPage = selectionByPage();
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;
    for (const [index, { boxes, page }] of byPage) {
      const quads = selectionQuads(boxes, page.view.viewport);
      if (quads.length > 0) add({ page: index, kind: tool, quads, text: '', rotation: page.view.pdfPage?.rotate ?? 0 });
    }
    selection.removeAllRanges();
  };

  /** Note or text box: placed where the page is clicked. */
  const placeAt = (e: React.MouseEvent): boolean => {
    if (redacting || (tool !== 'note' && tool !== 'text')) return false;
    const page = pageAt(e.target as Element);
    if (!page) return false;
    const origin = page.div.getBoundingClientRect();
    const x = e.clientX - origin.left;
    const y = e.clientY - origin.top;
    const vp = page.view.viewport;
    const id =
      tool === 'note'
        ? add({ page: page.index, kind: 'note', box: boxAt(x, y, 24, 24, vp), text: '', rotation: page.view.pdfPage?.rotate ?? 0 })
        : add({ page: page.index, kind: 'text', box: boxAt(x, y, 220, TEXT_BOX_POINTS * 1.2 * 2 + 8, vp), text: '', fontSize: TEXT_BOX_POINTS, rotation: page.view.pdfPage?.rotate ?? 0 });
    setJustPlaced(id);
    setTool('select');
    return true;
  };

  // Delete, Escape and undo/redo for annotations, while this screen is showing.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('input, textarea, select') || document.querySelector('.sf-dialog')) return;
      const ctrl = e.ctrlKey || e.metaKey;
      if (redacting) {
        if (ctrl && e.key.toLowerCase() === 'z') redactDispatch({ type: 'undo' });
        else if (ctrl && e.key.toLowerCase() === 'y') redactDispatch({ type: 'redo' });
        else if (e.key === 'Delete' && redact.selected) redactDispatch({ type: 'remove', ids: [redact.selected] });
        else if (e.key === 'Escape' && (redact.selected || redactTool !== 'select')) {
          redactDispatch({ type: 'select', id: null });
          setRedactTool('select');
        } else return;
        e.preventDefault();
        return;
      }
      if (ctrl && e.key.toLowerCase() === 'z') annotDispatch({ type: 'undo' });
      else if (ctrl && e.key.toLowerCase() === 'y') annotDispatch({ type: 'redo' });
      else if (e.key === 'Delete' && annots.selected) annotDispatch({ type: 'remove', id: annots.selected });
      else if (e.key === 'Escape' && (annots.selected || tool !== 'select')) {
        annotDispatch({ type: 'select', id: null });
        setTool('select');
      } else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, annots.selected, annotDispatch, tool, redacting, redact.selected, redactDispatch, redactTool]);

  // Web links in the document: show the address and ask first. Links inside the document
  // (to another page) are handled by pdf.js as usual.
  const onClickCapture = (event: React.MouseEvent) => {
    if (placeAt(event)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const anchor = (event.target as HTMLElement).closest('a');
    if (!anchor) return;
    const href = anchor.getAttribute('href') ?? '';
    if (href === '' || href.startsWith('#')) return;
    event.preventDefault();
    event.stopPropagation();
    if (isOpenableLink(anchor.href)) onAskLink(anchor.href);
    else onRefusedLink(href);
  };
  const onAuxClickCapture = (event: React.MouseEvent) => {
    if ((event.target as HTMLElement).closest('a')) event.preventDefault();
  };

  const zoomKnown = ZOOM_CHOICES.some((z) => z.value === zoom.value);
  const selectedAnnot = redacting ? null : (annots.items.find((a) => a.id === annots.selected) ?? null);
  const selectedMark = redacting ? (redact.marks.find((m) => m.id === redact.selected) ?? null) : null;
  const switchMode = (next: 'annotate' | 'redact') => {
    setMode(next);
    setTool('select');
    setRedactTool('select');
    annotDispatch({ type: 'select', id: null });
    redactDispatch({ type: 'select', id: null });
  };
  const lead = <ModeSwitch mode={mode} onMode={switchMode} />;

  return (
    <div className="sf-document">
      <div className="sf-toolbar" role="toolbar" aria-label="Document">
        <button
          type="button"
          className="sf-icon-button"
          aria-pressed={showThumbs}
          aria-label="Thumbnails"
          title="Thumbnails (Ctrl+T)"
          onClick={() => setShowThumbs((s) => !s)}
        >
          <Icon name="thumbnails" />
        </button>
        <span className="sf-toolbar-gap" />
        <button type="button" className="sf-icon-button" aria-label="Previous page" onClick={() => goTo(page - 1)} disabled={page <= 1}>
          <Icon name="previous" />
        </button>
        <label className="sf-page-field">
          <span>Page</span>
          <input
            type="text"
            inputMode="numeric"
            aria-label="Page number"
            value={pageInput}
            onChange={(e) => setPageInput(e.target.value.replace(/[^0-9]/g, ''))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') goTo(Number(pageInput) || page);
            }}
            onBlur={() => setPageInput(String(page))}
          />
          <span data-testid="page-count">of {pdf.numPages}</span>
        </label>
        <button
          type="button"
          className="sf-icon-button"
          aria-label="Next page"
          onClick={() => goTo(page + 1)}
          disabled={page >= pdf.numPages}
        >
          <Icon name="next" />
        </button>
        <span className="sf-toolbar-gap" />
        <button type="button" className="sf-icon-button" aria-label="Zoom out" title="Zoom out (Ctrl+-)" onClick={() => viewerRef.current?.decreaseScale()}>
          <Icon name="zoom-out" />
        </button>
        <select aria-label="Zoom" value={zoomKnown ? zoom.value : 'custom'} onChange={(e) => setZoomValue(e.target.value)}>
          {!zoomKnown && <option value="custom">{zoom.percent}%</option>}
          {ZOOM_CHOICES.map((z) => (
            <option key={z.value} value={z.value}>
              {z.label}
            </option>
          ))}
        </select>
        <button type="button" className="sf-icon-button" aria-label="Zoom in" title="Zoom in (Ctrl+=)" onClick={() => viewerRef.current?.increaseScale()}>
          <Icon name="zoom-in" />
        </button>
        <span className="sf-toolbar-gap" />
        <div className="sf-search" role="search">
          <Icon name="search" size={18} />
          <input
            ref={searchRef}
            type="search"
            aria-label="Find in document"
            placeholder="Find in document"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') runFind(query, true, e.shiftKey);
              if (e.key === 'Escape') setQuery('');
            }}
          />
          <span className="sf-search-count" data-testid="find-count" aria-live="polite">
            {query && find ? (find.total > 0 ? `${find.current} of ${find.total}` : find.notFound ? 'Not found' : '') : ''}
          </span>
          <button type="button" className="sf-icon-button" aria-label="Previous match" disabled={!query} onClick={() => runFind(query, true, true)}>
            <Icon name="previous" size={18} />
          </button>
          <button type="button" className="sf-icon-button" aria-label="Next match" disabled={!query} onClick={() => runFind(query, true)}>
            <Icon name="next" size={18} />
          </button>
        </div>
        <span className="sf-toolbar-fill" />
        <span className="sf-doc-name" title={name}>
          {name}
        </span>
        <button type="button" className="sf-icon-button" aria-label="Close document" title="Close (Ctrl+W)" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
      {changed && (
        <p className="sf-banner" data-testid="pages-banner">
          This shows the file as it was opened. Your changes on the Pages screen go into the new file when you save.
        </p>
      )}
      {redacting ? (
        <RedactToolbar
          lead={lead}
          tool={redactTool}
          onTool={(t) => {
            setRedactTool(t);
            if (t !== 'select') redactDispatch({ type: 'select', id: null });
          }}
          onFind={(term) => void findAndMark(term)}
          finding={finding}
          canUndo={redact.past.length > 0}
          canRedo={redact.future.length > 0}
          onUndo={() => redactDispatch({ type: 'undo' })}
          onRedo={() => redactDispatch({ type: 'redo' })}
          marks={redact.marks.length}
          onReview={onRedact}
          working={working}
          status={findResult}
        />
      ) : (
      <AnnotateToolbar
        lead={lead}
        tool={tool}
        onTool={(t) => {
          setTool(t);
          if (t !== 'select') annotDispatch({ type: 'select', id: null });
        }}
        colourId={colourId}
        onColour={setColourId}
        canUndo={annots.past.length > 0}
        canRedo={annots.future.length > 0}
        onUndo={() => annotDispatch({ type: 'undo' })}
        onRedo={() => annotDispatch({ type: 'redo' })}
        onSave={onSave}
        working={working}
      />
      )}
      <div className="sf-document-body">
        {showThumbs && <Thumbnails pdf={pdf} currentPage={page} onSelect={goTo} />}
        <div className="sf-viewer-frame">
          <div
            ref={containerRef}
            className={`sf-viewer-container${!redacting && (tool === 'note' || tool === 'text') ? ' sf-placing' : ''}${redacting && redactTool === 'area' ? ' sf-drawing' : ''}`}
            data-testid="viewer"
            data-tool={redacting ? `redact-${redactTool}` : tool}
            onMouseDownCapture={startArea}
            onClickCapture={onClickCapture}
            onMouseUp={markSelection}
            onAuxClickCapture={onAuxClickCapture}
          >
            <div className="pdfViewer" />
            <AnnotationLayer
              viewer={viewerRef.current}
              container={containerRef.current}
              annots={annots.items}
              selected={annots.selected}
              interactive={!redacting && tool === 'select'}
              layout={layout}
              onSelect={(id) => annotDispatch({ type: 'select', id })}
            />
            <RedactionLayer
              viewer={viewerRef.current}
              container={containerRef.current}
              marks={redact.marks}
              selected={redact.selected}
              interactive={redacting && redactTool === 'select'}
              drag={drag}
              layout={layout}
              onSelect={(id) => redactDispatch({ type: 'select', id })}
            />
          </div>
          {selectedAnnot && <AnnotationPanel annot={selectedAnnot} dispatch={annotDispatch} focusText={justPlaced === selectedAnnot.id} />}
          {selectedMark && <MarkPanel mark={selectedMark} marks={redact.marks} dispatch={redactDispatch} />}
        </div>
      </div>
    </div>
  );
}
