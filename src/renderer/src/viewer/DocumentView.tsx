import './pdfjs';
import { useCallback, useEffect, useRef, useState } from 'react';
import { EventBus, PDFFindController, PDFLinkService, PDFViewer } from 'pdfjs-dist/web/pdf_viewer.mjs';
import type { MenuCommand } from '../../../shared/api';
import { isOpenableLink } from '../../../shared/links';
import { Icon } from '../components/Icon';
import { pdfjsLib, type PdfDocument } from './pdfjs';
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
  command,
  onAskLink,
  onRefusedLink,
  onClose,
}: {
  pdf: PdfDocument;
  name: string;
  /** A menu command for this screen, with a counter so repeats still arrive. */
  command: { name: MenuCommand; seq: number } | null;
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
    viewer.setDocument(pdf);
    linkService.setDocument(pdf, null);
    viewerRef.current = viewer;
    busRef.current = eventBus;
    return () => {
      viewerRef.current = null;
      busRef.current = null;
      // Clear this viewer's pages completely, so nothing of this document is left behind.
      viewer.setDocument(null);
      linkService.setDocument(null);
      delete container.dataset.ready;
    };
  }, [pdf]);

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

  // Web links in the document: show the address and ask first. Links inside the document
  // (to another page) are handled by pdf.js as usual.
  const onClickCapture = (event: React.MouseEvent) => {
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
      <div className="sf-document-body">
        {showThumbs && <Thumbnails pdf={pdf} currentPage={page} onSelect={goTo} />}
        <div className="sf-viewer-frame">
          <div
            ref={containerRef}
            className="sf-viewer-container"
            data-testid="viewer"
            onClickCapture={onClickCapture}
            onAuxClickCapture={onAuxClickCapture}
          >
            <div className="pdfViewer" />
          </div>
        </div>
      </div>
    </div>
  );
}
