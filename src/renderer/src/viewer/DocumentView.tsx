import './pdfjs';
import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch } from 'react';
import { EventBus, PDFFindController, PDFLinkService, PDFViewer } from 'pdfjs-dist/web/pdf_viewer.mjs';
import type { MenuCommand } from '../../../shared/api';
import { isOpenableLink } from '../../../shared/links';
import { DEFAULT_ANNOTATION_COLOUR } from '../../../shared/annotationColours';
import { AnnotateToolbar, type Tool, type ToolOptions } from '../annotate/AnnotateToolbar';
import { AnnotationLayer, type Handle } from '../annotate/AnnotationLayer';
import { AnnotationPanel, type PanelTarget } from '../annotate/AnnotationPanel';
import {
  annotPoints,
  DEFAULT_LINE_WIDTH,
  movable,
  moved,
  newAnnotId,
  scaledPaths,
  STAMPS,
  TEXT_BOX_POINTS,
  type Annot,
  type AnnotAction,
  type AnnotChanges,
  type AnnotState,
} from '../annotate/annotState';
import { CommentsPanel, commentEntries } from '../annotate/CommentsPanel';
import { asAnnot, hiddenFromViewer, needsRedraw, type FileAnnot } from '../annotate/fileAnnots';
import { boxAt, boxToBounds, boxToQuad, pointsToBox, quadToBox, selectionQuads, type Box } from '../annotate/geometry';
import { Icon } from '../components/Icon';
import type { Pt, Rect, Rotation } from '../../../engine/types';
import { findTerm, glyphsIn, lineBoxes, PADDING, pageGlyphs, pageMayContain, type Glyph } from '../redact/glyphs';
import { MarkPanel } from '../redact/MarkPanel';
import { PatternDialog, type FoundMatch } from '../redact/PatternDialog';
import { findPatterns, textMayMatch, type PatternId } from '../redact/patterns';
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

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Today, as a stamp shows it: "October 21, 2026". */
const stampDate = () => new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

/** A stamp's size when placed, in points. */
const STAMP_SIZE = { width: 160, height: 56 };

export function DocumentView({
  pdf,
  name,
  changed,
  command,
  annots,
  annotDispatch,
  fileAnnots,
  fileLoading,
  authorName,
  redact,
  redactDispatch,
  onRedact,
  active,
  working,
  onSave,
  onAskLink,
  onRefusedLink,
  onClose,
  signatureNote,
  placing,
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
  /** The annotations already in the file, as pdf.js reads them. */
  fileAnnots: FileAnnot[];
  /** While they're still being read: "Reading comments, page n of m…". */
  fileLoading: string | null;
  /** The name put on new annotations (Settings). */
  authorName: string;
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
  /** What checking the file's signatures found, in a sentence, with a way to see them. */
  signatureNote: { text: string; onShow: () => void } | null;
  /** Drawing a signature's box: the box, on a page as it's shown, or cancelled. */
  placing: { onPlaced: (page: number, rect: Rect, rotation: Rotation) => void; onCancel: () => void } | null;
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
  const [options, setOptions] = useState<ToolOptions>({ shape: 'rect', width: DEFAULT_LINE_WIDTH, fill: false, fontSize: TEXT_BOX_POINTS, stamp: 'approved', stampText: '' });
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [draft, setDraft] = useState<Annot | null>(null);
  /** The drawing that new strokes join, until another tool is chosen. */
  const inkTarget = useRef<string | null>(null);
  const [focusReply, setFocusReply] = useState<string | null>(null);
  const dragCount = useRef(0);
  const [mode, setMode] = useState<'annotate' | 'redact'>('annotate');
  const [redactTool, setRedactTool] = useState<RedactTool>('select');
  const [drag, setDrag] = useState<DragBox | null>(null);
  const [finding, setFinding] = useState(false);
  const [findResult, setFindResult] = useState<string | null>(null);
  const [patternsOpen, setPatternsOpen] = useState(false);
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

  // The file's own annotations that ScribeForge draws itself (changed ones), or not at all
  // (deleted ones, and replies, which show in the panels): pdf.js leaves them out of the page
  // drawing and of its own clickable layer. pdf.js does the same for annotations its editor
  // changes, through the document's `modifiedIds`.
  const hidden = useMemo(() => hiddenFromViewer(fileAnnots, annots.edits), [fileAnnots, annots.edits]);
  const hiddenKey = [...hidden].sort().join(',');
  const hiddenSet = useRef(new Set<string>());
  useEffect(() => {
    const ids = new Set(hiddenKey ? hiddenKey.split(',') : []);
    const before = [...hiddenSet.current].sort().join(',');
    hiddenSet.current = ids;
    Object.defineProperty(pdf.annotationStorage, 'modifiedIds', { configurable: true, get: () => ({ ids, hash: hiddenKey }) });
    const hideInLayer = () => {
      for (const el of containerRef.current?.querySelectorAll<HTMLElement>('.annotationLayer [data-annotation-id]') ?? []) {
        el.style.display = hiddenSet.current.has(el.dataset.annotationId ?? '') ? 'none' : '';
      }
    };
    hideInLayer();
    busRef.current?.on('annotationlayerrendered', hideInLayer);
    if (before !== hiddenKey) viewerRef.current?.refresh();
    return () => busRef.current?.off('annotationlayerrendered', hideInLayer);
  }, [pdf, hiddenKey]);

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

  /** Adds an annotation in the chosen colour (unless it has its own), selecting it unless `select` is false. */
  const add = (annot: Partial<Annot> & Pick<Annot, 'page' | 'kind' | 'text' | 'rotation'>, select = true) => {
    const id = newAnnotId();
    annotDispatch({ type: 'add', annot: { colourId, ...annot, id, createdAt: new Date().toISOString() } as Annot, select });
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
    const found: { page: number; text: string; boxes: Rect[] }[] = [];
    try {
      for (let index = 0; index < pdf.numPages; index++) {
        if (index % 25 === 0) setFindResult(`Searching page ${index + 1} of ${pdf.numPages}…`);
        // Quick check of the page's text first; letter positions only for pages with a match.
        if (!(await pageMayContain(await pdf.getPage(index + 1), term))) continue;
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

  /** Find patterns: every match of the chosen patterns and words, on every page. */
  const searchPatterns = async (patterns: PatternId[], words: string[], progress: (text: string) => void): Promise<FoundMatch[]> => {
    const found: FoundMatch[] = [];
    for (let index = 0; index < pdf.numPages; index++) {
      if (index % 10 === 0) progress(`Searching page ${index + 1} of ${pdf.numPages}…`);
      // Quick check of the page's text first; letter positions only for pages that might match.
      const content = await (await pdf.getPage(index + 1)).getTextContent();
      const text = content.items.map((i) => ('str' in i ? i.str : '')).join(' ');
      if (!textMayMatch(text, patterns, words)) continue;
      findPatterns(await glyphsOf(index), patterns, words).forEach((m, i) => found.push({ ...m, id: `${index}-${i}`, page: index }));
    }
    return found;
  };

  /**
   * The ticked matches become marks. Each value is a group of its own, sized by how many times it
   * was found, so the last check searches the redacted file only for values marked everywhere.
   */
  const markPatterns = (ticked: FoundMatch[], all: FoundMatch[]) => {
    const keyOf = (m: FoundMatch) => (m.pattern === 'words' ? `words:${m.term}` : `${m.pattern}:${m.text.replace(/\s+/g, ' ')}`);
    const totals = new Map<string, number>();
    for (const m of all) totals.set(keyOf(m), (totals.get(keyOf(m)) ?? 0) + 1);
    const groups = new Map<string, string>();
    const marks: RedactMark[] = ticked.map((m) => {
      const key = keyOf(m);
      if (!groups.has(key)) groups.set(key, newMarkId());
      return {
        id: newMarkId(),
        page: m.page,
        kind: 'search',
        rects: m.boxes,
        text: m.text,
        term: m.pattern === 'words' ? m.term : m.text,
        group: groups.get(key),
        groupSize: totals.get(key),
        pattern: m.pattern,
      };
    });
    redactDispatch({ type: 'add', marks });
    setPatternsOpen(false);
    const pages = new Set(ticked.map((m) => m.page)).size;
    setFindResult(`Marked ${plural(ticked.length, 'match', 'matches')} on ${plural(pages, 'page')}.`);
  };

  /** A signature's box: drag it out on a page, after choosing to sign with a box. */
  const startSignatureBox = (e: React.MouseEvent) => {
    if (!placing || e.button !== 0) return;
    const page = pageAt(e.target as Element);
    if (!page) return;
    e.preventDefault();
    e.stopPropagation();
    const origin = page.div.getBoundingClientRect();
    const sx = e.clientX - origin.left;
    const sy = e.clientY - origin.top;
    const clamp = (v: number, max: number) => Math.min(Math.max(v, 0), max);
    const boxFor = (ev: MouseEvent): DragBox => {
      const now = page.div.getBoundingClientRect();
      const x = clamp(ev.clientX - now.left, now.width);
      const y = clamp(ev.clientY - now.top, now.height);
      return { page: page.index, left: Math.min(sx, x), top: Math.min(sy, y), right: Math.max(sx, x), bottom: Math.max(sy, y), signature: true };
    };
    const move = (ev: MouseEvent) => setDrag(boxFor(ev));
    const up = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      setDrag(null);
      const box = boxFor(ev);
      if (box.right - box.left < 8 || box.bottom - box.top < 8) return; // a click, not a box
      const vp = page.view.viewport;
      const a = vp.convertToPdfPoint(box.left, box.top);
      const b = vp.convertToPdfPoint(box.right, box.bottom);
      const rect: Rect = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
      const turn = page.view.pdfPage?.rotate ?? 0;
      placing.onPlaced(page.index, rect, ((((turn % 360) + 360) % 360) as Rotation));
    };
    setDrag(boxFor(e.nativeEvent));
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
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

  /** Note, text box or stamp: placed where the page is clicked. */
  const placeAt = (e: React.MouseEvent): boolean => {
    if (redacting || (tool !== 'note' && tool !== 'text' && tool !== 'stamp')) return false;
    const page = pageAt(e.target as Element);
    if (!page) return false;
    const origin = page.div.getBoundingClientRect();
    const x = e.clientX - origin.left;
    const y = e.clientY - origin.top;
    const vp = page.view.viewport;
    const rotation = page.view.pdfPage?.rotate ?? 0;
    let id: string;
    if (tool === 'note') id = add({ page: page.index, kind: 'note', box: boxAt(x, y, 24, 24, vp), text: '', rotation });
    else if (tool === 'text') {
      id = add({ page: page.index, kind: 'text', box: boxAt(x, y, 220, options.fontSize * 1.2 * 2 + 8, vp), text: '', fontSize: options.fontSize, rotation });
    } else {
      const preset = STAMPS.find((s) => s.id === options.stamp);
      const custom = options.stamp === 'custom';
      id = add({
        page: page.index,
        kind: 'stamp',
        box: boxAt(x, y, STAMP_SIZE.width, STAMP_SIZE.height, vp),
        stamp: options.stamp,
        label: custom ? options.stampText.trim() : preset?.label,
        date: stampDate(),
        text: '',
        rotation,
        ...(custom ? {} : { colourId: preset?.colourId }),
      });
    }
    setJustPlaced(id);
    setTool('select');
    return true;
  };

  /** Where the mouse is on a page, in the page's own space. */
  const pdfPointAt = (page: NonNullable<ReturnType<typeof pageAt>>, clientX: number, clientY: number): Pt => {
    const o = page.div.getBoundingClientRect();
    const [x, y] = page.view.viewport.convertToPdfPoint(clientX - o.left, clientY - o.top);
    return [round2(x), round2(y)];
  };

  /** Draw (freehand) and Shape: drag on the page. */
  const startDrawing = (e: React.MouseEvent): boolean => {
    if (redacting || e.button !== 0 || (tool !== 'ink' && tool !== 'shape')) return false;
    const page = pageAt(e.target as Element);
    if (!page) return false;
    e.preventDefault();
    window.getSelection()?.removeAllRanges();
    const rotation = page.view.pdfPage?.rotate ?? 0;
    const base = { id: 'draft', page: page.index, colourId, text: '', rotation, createdAt: '', width: options.width };
    const start = pdfPointAt(page, e.clientX, e.clientY);
    const startScreen = [e.clientX, e.clientY];
    const points: Pt[] = [start];
    const shape = options.shape;
    let end = start;
    let frame = 0;

    const draftNow = (): Annot => {
      if (tool === 'ink') return { ...base, kind: 'ink', paths: [points.slice()] };
      if (shape === 'line' || shape === 'arrow') return { ...base, kind: shape, from: start, to: end };
      const vp = page.view.viewport;
      const box = pointsToBox([start, end], vp);
      return { ...base, kind: shape, box: boxToQuad(box, vp), fill: options.fill };
    };
    const move = (ev: MouseEvent) => {
      const p = pdfPointAt(page, ev.clientX, ev.clientY);
      end = p;
      const last = points[points.length - 1];
      if (Math.hypot(p[0] - last[0], p[1] - last[1]) >= 0.75) points.push(p);
      if (!frame) {
        frame = requestAnimationFrame(() => {
          frame = 0;
          setDraft(draftNow());
        });
      }
    };
    const up = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      if (frame) cancelAnimationFrame(frame);
      setDraft(null);
      end = pdfPointAt(page, ev.clientX, ev.clientY);
      if (tool === 'ink') {
        if (points.length === 1) points.push(start);
        const target = annots.items.find((a) => a.id === inkTarget.current && a.page === page.index && a.kind === 'ink');
        if (target) annotDispatch({ type: 'update', id: target.id, paths: [...(target.paths ?? []), points] });
        else inkTarget.current = add({ ...base, kind: 'ink', paths: [points] }, false);
        return;
      }
      // A click without a drag doesn't make a shape.
      if (Math.hypot(ev.clientX - startScreen[0], ev.clientY - startScreen[1]) < 4) return;
      const made = draftNow();
      const { id: _id, createdAt: _c, ...rest } = made;
      setJustPlaced(add(rest));
      setTool('select');
    };
    setDraft(draftNow());
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return true;
  };

  /**
   * The mouse went down on an annotation (or one of its handles) with Select: it's selected, and
   * dragging moves it, or resizes it from the handle. One drag is one undo step.
   */
  const grab = (id: string, e: React.MouseEvent, handle?: Handle) => {
    annotDispatch({ type: 'select', id });
    const original = annots.items.find((a) => a.id === id);
    const vp = original ? viewerRef.current?.getPageView(original.page)?.viewport : undefined;
    if (!original || !movable(original) || !vp) return;
    // No text selection while dragging. Typing in the panel is over: Ctrl+Z now undoes the drag.
    e.preventDefault();
    const typing = document.activeElement;
    if (typing instanceof HTMLTextAreaElement || typing instanceof HTMLInputElement) typing.blur();
    const [sx, sy] = [e.clientX, e.clientY];
    const key = `drag-${++dragCount.current}`;
    let dragging = false;
    const startBox = original.box ? quadToBox(original.box, vp) : pointsToBox(annotPoints(original), vp);
    const move = (ev: MouseEvent) => {
      const dx = ev.clientX - sx;
      const dy = ev.clientY - sy;
      if (!dragging && Math.hypot(dx, dy) < 3) return;
      dragging = true;
      const [ox, oy] = vp.convertToPdfPoint(0, 0);
      const [px, py] = vp.convertToPdfPoint(dx, dy);
      let change: AnnotChanges;
      if (!handle) change = moved(original, px - ox, py - oy);
      else if (handle === 'from' || handle === 'to') {
        const point = original[handle] as Pt;
        change = { [handle]: [round2(point[0] + px - ox), round2(point[1] + py - oy)] };
      } else {
        const b: Box = { ...startBox };
        if (handle.includes('w')) b.left = Math.min(startBox.right - 8, startBox.left + dx);
        if (handle.includes('e')) b.right = Math.max(startBox.left + 8, startBox.right + dx);
        if (handle.includes('n')) b.top = Math.min(startBox.bottom - 8, startBox.top + dy);
        if (handle.includes('s')) b.bottom = Math.max(startBox.top + 8, startBox.bottom + dy);
        change = original.box ? { box: boxToQuad(b, vp) } : { paths: scaledPaths(original.paths ?? [], boxToBounds(startBox, vp), boxToBounds(b, vp)) };
      }
      annotDispatch({ type: 'update', id, typing: key, ...change });
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  /** Arrow keys move the selected annotation; with Alt they resize it. Shift moves further. */
  const nudge = (key: string, shift: boolean, alt: boolean): boolean => {
    const a = annots.items.find((x) => x.id === annots.selected);
    const vp = a ? viewerRef.current?.getPageView(a.page)?.viewport : undefined;
    if (!a || !movable(a) || !vp) return false;
    const step = (shift ? 10 : 1) * vp.scale;
    const [dx, dy] = key === 'ArrowLeft' ? [-step, 0] : key === 'ArrowRight' ? [step, 0] : key === 'ArrowUp' ? [0, -step] : [0, step];
    const [ox, oy] = vp.convertToPdfPoint(0, 0);
    const [px, py] = vp.convertToPdfPoint(dx, dy);
    let change: AnnotChanges;
    if (!alt) change = moved(a, px - ox, py - oy);
    else if (a.from && a.to) change = { to: [round2(a.to[0] + px - ox), round2(a.to[1] + py - oy)] };
    else {
      const box = a.box ? quadToBox(a.box, vp) : pointsToBox(annotPoints(a), vp);
      const b = { ...box, right: Math.max(box.left + 8, box.right + dx), bottom: Math.max(box.top + 8, box.bottom + dy) };
      change = a.box ? { box: boxToQuad(b, vp) } : { paths: scaledPaths(a.paths ?? [], boxToBounds(box, vp), boxToBounds(b, vp)) };
    }
    annotDispatch({ type: 'update', id: a.id, typing: `keys-${a.id}`, ...change });
    return true;
  };

  const nudgeRef = useRef(nudge);
  nudgeRef.current = nudge;

  /** Adds an empty reply under what's selected, and puts the cursor in it. */
  const reply = (parent: string) => {
    const page = parent.startsWith('file:') ? fileAnnots.find((f) => `file:${f.id}` === parent)?.page : annots.items.find((a) => a.id === parent)?.page;
    if (page === undefined) return;
    const id = add({ page, kind: 'reply', replyTo: parent, text: '', rotation: 0 }, false);
    setFocusReply(id);
  };

  // Delete, Escape and undo/redo for annotations, while this screen is showing.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('input, textarea, select') || document.querySelector('.sf-dialog')) return;
      const ctrl = e.ctrlKey || e.metaKey;
      if (placing) {
        if (e.key === 'Escape') {
          e.preventDefault();
          placing.onCancel();
        }
        return;
      }
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
      if (ctrl && e.shiftKey && e.key.toLowerCase() === 'm') setCommentsOpen((open) => !open);
      else if (ctrl && e.key.toLowerCase() === 'z') annotDispatch({ type: 'undo' });
      else if (ctrl && e.key.toLowerCase() === 'y') annotDispatch({ type: 'redo' });
      else if (e.key === 'Delete' && annots.selected?.startsWith('file:')) annotDispatch({ type: 'edit-file', ref: annots.selected.slice(5), deleted: true });
      else if (e.key === 'Delete' && annots.selected) annotDispatch({ type: 'remove', id: annots.selected });
      else if (e.key.startsWith('Arrow') && !ctrl && annots.selected && nudgeRef.current(e.key, e.shiftKey, e.altKey)) {
        // moved or resized
      } else if (e.key === 'Escape' && (annots.selected || tool !== 'select')) {
        annotDispatch({ type: 'select', id: null });
        setTool('select');
      } else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, annots.selected, annotDispatch, tool, redacting, redact.selected, redactDispatch, redactTool, placing]);

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
  const selectedMark = redacting ? (redact.marks.find((m) => m.id === redact.selected) ?? null) : null;

  // The file's own annotations: those that can be clicked, and those changed here (drawn by ScribeForge).
  const shownFiles = fileAnnots.filter((f) => !f.inReplyTo && !f.hidden && !annots.edits[f.id]?.deleted);
  const redrawn = shownFiles.flatMap((f) => (annots.edits[f.id] && needsRedraw(f, annots.edits[f.id]) ? (asAnnot(f, annots.edits[f.id]) ?? []) : []));

  // What the panel shows: the selected annotation, with its replies (and replies to those).
  let target: PanelTarget | null = null;
  if (!redacting && annots.selected?.startsWith('file:')) {
    const file = fileAnnots.find((f) => f.id === annots.selected?.slice(5));
    if (file && !annots.edits[file.id]?.deleted) target = { kind: 'file', file, edit: annots.edits[file.id] ?? {} };
  } else if (!redacting && annots.selected) {
    const annot = annots.items.find((a) => a.id === annots.selected && a.kind !== 'reply');
    if (annot) target = { kind: 'new', annot };
  }
  const threadOf = (key: string) => {
    const fileThread: FileAnnot[] = [];
    const addedThread: Annot[] = [];
    const keys = [key];
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      for (const f of fileAnnots) {
        if (k.startsWith('file:') && f.inReplyTo === k.slice(5) && !annots.edits[f.id]?.deleted) {
          fileThread.push(f);
          keys.push(`file:${f.id}`);
        }
      }
      for (const a of annots.items) {
        if (a.kind === 'reply' && a.replyTo === k) {
          addedThread.push(a);
          keys.push(a.id);
        }
      }
    }
    return { fileThread, addedThread };
  };
  const thread = target ? threadOf(target.kind === 'new' ? target.annot.id : `file:${target.file.id}`) : null;
  const entries = useMemo(() => commentEntries(annots.items, fileAnnots, annots.edits, authorName), [annots.items, fileAnnots, annots.edits, authorName]);
  const openEntry = (key: string, page: number) => {
    if (mode !== 'annotate') switchMode('annotate');
    setTool('select');
    goTo(page + 1);
    annotDispatch({ type: 'select', id: key });
  };
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
      {signatureNote && !placing && (
        <p className="sf-banner" data-testid="signatures-banner">
          {signatureNote.text}{' '}
          <button type="button" className="sf-link-button" onClick={signatureNote.onShow}>
            See the signatures
          </button>
        </p>
      )}
      {placing && (
        <div className="sf-banner sf-notice sf-placing-banner" data-testid="placing-banner">
          <p>Drag a box on the page where the signature should go. Its name, date and reason are drawn inside it.</p>
          <button type="button" className="sf-button" onClick={placing.onCancel}>
            Cancel signing
          </button>
        </div>
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
          onPatterns={() => setPatternsOpen(true)}
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
          inkTarget.current = null;
          if (t !== 'select') annotDispatch({ type: 'select', id: null });
        }}
        colourId={colourId}
        onColour={setColourId}
        options={options}
        onOptions={(change) => setOptions((o) => ({ ...o, ...change }))}
        canUndo={annots.past.length > 0}
        canRedo={annots.future.length > 0}
        onUndo={() => annotDispatch({ type: 'undo' })}
        onRedo={() => annotDispatch({ type: 'redo' })}
        commentsOpen={commentsOpen}
        onComments={() => setCommentsOpen((open) => !open)}
        onSave={onSave}
        working={working}
      />
      )}
      <div className="sf-document-body">
        {showThumbs && <Thumbnails pdf={pdf} currentPage={page} onSelect={goTo} />}
        <div className="sf-viewer-frame">
          <div
            ref={containerRef}
            className={`sf-viewer-container${!placing && !redacting && (tool === 'note' || tool === 'text' || tool === 'stamp') ? ' sf-placing' : ''}${placing || (redacting && redactTool === 'area') || (!redacting && (tool === 'ink' || tool === 'shape')) ? ' sf-drawing' : ''}`}
            data-testid="viewer"
            data-tool={placing ? 'signature' : redacting ? `redact-${redactTool}` : tool}
            onMouseDownCapture={(e) => {
              if (placing) startSignatureBox(e);
              else if (!startDrawing(e)) startArea(e);
            }}
            onClickCapture={onClickCapture}
            onMouseUp={markSelection}
            onAuxClickCapture={onAuxClickCapture}
          >
            <div className="pdfViewer" />
            <AnnotationLayer
              viewer={viewerRef.current}
              container={containerRef.current}
              annots={annots.items}
              files={shownFiles}
              redrawn={redrawn}
              selected={annots.selected}
              interactive={!redacting && tool === 'select'}
              layout={layout}
              draft={draft}
              onSelect={(id) => annotDispatch({ type: 'select', id })}
              onGrab={grab}
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
          {target && thread && (
            <AnnotationPanel
              key={target.kind === 'new' ? target.annot.id : target.file.id}
              target={target}
              fileReplies={thread.fileThread}
              addedReplies={thread.addedThread}
              authorName={authorName}
              flattenAll={annots.flattenAll}
              dispatch={annotDispatch}
              focusText={target.kind === 'new' && justPlaced === target.annot.id}
              focusReply={focusReply}
              onReply={reply}
            />
          )}
          {selectedMark && <MarkPanel mark={selectedMark} marks={redact.marks} dispatch={redactDispatch} />}
          {patternsOpen && <PatternDialog search={searchPatterns} onMark={markPatterns} onCancel={() => setPatternsOpen(false)} />}
        </div>
        {commentsOpen && (
          <CommentsPanel
            entries={entries}
            loading={fileLoading}
            selected={annots.selected}
            flattenAll={annots.flattenAll}
            onOpen={(entry) => openEntry(entry.key, entry.page)}
            onFlattenAll={(on) => annotDispatch({ type: 'flatten-all', on })}
            onClose={() => setCommentsOpen(false)}
          />
        )}
      </div>
    </div>
  );
}
