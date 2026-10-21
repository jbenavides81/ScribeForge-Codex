import type { CSSProperties, ReactNode } from 'react';
import { annotationColour } from '../../../shared/annotationColours';
import { arrowHead } from '../../../engine/marks';
import type { Pt, Quad } from '../../../engine/types';
import { Icon } from '../components/Icon';
import type { PDFViewer } from 'pdfjs-dist/web/pdf_viewer.mjs';
import { ANNOT_NAMES, annotPoints, DEFAULT_LINE_WIDTH, movable, TEXT_BOX_POINTS, type Annot } from './annotState';
import { fileKindName, type FileAnnot } from './fileAnnots';
import { markLineBox, pointsToBox, quadToBox, type Box, type Viewport } from './geometry';

/** Where a selected annotation can be grabbed to resize it: its corners, or a line's two ends. */
export type Handle = 'nw' | 'ne' | 'sw' | 'se' | 'from' | 'to';

/** How far Arial's letters rise above the baseline, as a share of the text size. */
const ASCENT = 0.905;

let measurer: CanvasRenderingContext2D | null = null;
/** Width of text 1 unit tall in Arial (bold or regular), as the saved stamp measures Helvetica. */
function textWidth(text: string, bold: boolean): number {
  measurer ??= document.createElement('canvas').getContext('2d');
  if (!measurer) return text.length * 0.6;
  measurer.font = `${bold ? 'bold ' : ''}100px Arial`;
  return measurer.measureText(text).width / 100;
}

interface Placed {
  viewport: Viewport;
  x: number;
  y: number;
}

/**
 * Draws over the document's pages, at the current zoom: annotations added in ScribeForge, the
 * file's own annotations that have been changed (pdf.js draws the rest), and click areas for the
 * file's own annotations. It sits beside pdf.js's pages inside the scrolling area, so it scrolls
 * with them. `layout` changes whenever pdf.js re-lays out the pages, which redraws this.
 */
export function AnnotationLayer({
  viewer,
  container,
  annots,
  files,
  redrawn,
  selected,
  interactive,
  draft,
  onSelect,
  onGrab,
}: {
  viewer: PDFViewer | null;
  container: HTMLDivElement | null;
  annots: Annot[];
  /** The file's own annotations that can be clicked (not deleted, and not replies). */
  files: FileAnnot[];
  /** The file's own annotations that have been changed, drawn here instead of by pdf.js. */
  redrawn: Annot[];
  selected: string | null;
  /** With the Select tool, annotations can be clicked; otherwise clicks go through to the page. */
  interactive: boolean;
  layout: number;
  /** A shape or drawing being made, shown as it goes. */
  draft: Annot | null;
  onSelect: (id: string) => void;
  /** The mouse went down on an annotation (or one of its handles), to move or resize it. */
  onGrab: (id: string, event: React.MouseEvent, handle?: Handle) => void;
}) {
  if (!viewer || !container) return null;
  const frame = container.getBoundingClientRect();

  const place = (pageIndex: number): Placed | null => {
    const view = viewer.getPageView(pageIndex);
    if (!view?.div || !view.viewport) return null;
    const page = view.div.getBoundingClientRect();
    return {
      viewport: view.viewport,
      x: page.left - frame.left + container.scrollLeft,
      y: page.top - frame.top + container.scrollTop,
    };
  };

  const at = (b: Box, x: number, y: number): CSSProperties => ({ left: `${x + b.left}px`, top: `${y + b.top}px`, width: `${b.right - b.left}px`, height: `${b.bottom - b.top}px` });

  const interactions = (id: string, label: string, title: string, grab: boolean) => ({
    'data-annot': id,
    'data-selected': id === selected,
    role: interactive ? 'button' : undefined,
    tabIndex: interactive ? 0 : -1,
    'aria-label': label,
    title,
    onMouseDown: (e: React.MouseEvent) => {
      if (!interactive || e.button !== 0) return;
      e.stopPropagation();
      if (grab) onGrab(id, e);
      else onSelect(id);
    },
    onClick: (e: React.MouseEvent) => {
      if (interactive) e.stopPropagation();
    },
    onKeyDown: (e: React.KeyboardEvent) => {
      if (interactive && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        onSelect(id);
      }
    },
  });

  /** One annotation drawn on its page. `draft` ones can't be clicked. */
  const drawAnnot = (a: Annot, where: Placed, isDraft = false): ReactNode => {
    const colour = annotationColour(a.colourId);
    const vp = where.viewport;
    const scale = vp.scale;
    const style = {
      '--sf-annot-colour': a.kind === 'highlight' || a.kind === 'note' ? colour.highlight : colour.ink,
      '--sf-annot-ink': colour.ink,
      '--sf-annot-light': colour.highlight,
    } as CSSProperties;
    const name = ANNOT_NAMES[a.kind];
    const label = `${name} on page ${a.page + 1}${a.text ? `: ${a.text}` : a.label ? `: ${a.label}` : ''}`;
    const common = isDraft ? { 'data-draft': true } : { 'data-kind': a.kind, ...interactions(a.id, label, a.text || a.label || name, movable(a) && !a.id.startsWith('file:')) };
    const key = isDraft ? 'draft' : a.id;

    if (a.kind === 'note' || a.kind === 'text' || a.kind === 'stamp') {
      const box = quadToBox(a.box as Quad, vp);
      if (a.kind === 'note') {
        return (
          <span key={key} className="sf-annot sf-annot-note" style={{ ...style, ...at(box, where.x, where.y) }} {...common}>
            <Icon name="note" size={Math.max(12, Math.round((box.right - box.left) * 0.7))} />
          </span>
        );
      }
      if (a.kind === 'stamp') {
        // Laid out as the saved stamp is (see the engine's stamp drawing): the same sizes and
        // baselines, with Arial standing in for Helvetica.
        const w = box.right - box.left;
        const h = box.bottom - box.top;
        const border = Math.max(1, Math.min(w, h) / 25);
        const text = a.label || ' ';
        const room = w - border * 6;
        const labelSize = Math.max(4, Math.min(h * 0.42, room / Math.max(0.01, textWidth(text, true))));
        const dateSize = Math.max(3, Math.min(h * 0.2, labelSize * 0.55, room / Math.max(0.01, textWidth(a.date ?? '', false))));
        const labelBaseline = h * 0.5 - dateSize * 0.3;
        const dateBaseline = h * 0.5 + dateSize * 1.35;
        return (
          <span
            key={key}
            className="sf-annot sf-annot-stamp"
            style={{ ...style, ...at(box, where.x, where.y), borderWidth: `${border}px`, borderRadius: `${Math.min(w, h) * 0.15}px` }}
            {...common}
          >
            <span className="sf-annot-stamp-label" style={{ fontSize: `${labelSize}px`, top: `${labelBaseline - labelSize * ASCENT - border}px` }}>
              {text}
            </span>
            <span className="sf-annot-stamp-date" style={{ fontSize: `${dateSize}px`, top: `${dateBaseline - dateSize * ASCENT - border}px` }}>
              {a.date}
            </span>
          </span>
        );
      }
      return (
        <span
          key={key}
          className="sf-annot sf-annot-text"
          data-empty={a.text.trim() === ''}
          style={{
            ...style,
            left: `${where.x + box.left}px`,
            top: `${where.y + box.top}px`,
            width: `${box.right - box.left}px`,
            minHeight: `${box.bottom - box.top}px`,
            fontSize: `${(a.fontSize ?? TEXT_BOX_POINTS) * scale}px`,
            padding: `${4 * scale}px`,
          }}
          {...common}
        >
          {a.text}
        </span>
      );
    }

    if (a.kind === 'ink' || a.kind === 'rect' || a.kind === 'ellipse' || a.kind === 'line' || a.kind === 'arrow') {
      const width = (a.width ?? DEFAULT_LINE_WIDTH) * scale;
      const head = a.kind === 'arrow' && a.from && a.to ? arrowHead(a.from, a.to, a.width ?? DEFAULT_LINE_WIDTH) : [];
      const points = [...annotPoints(a), ...head];
      if (points.length === 0) return null;
      const pad = width + 6;
      const bounds = pointsToBox(points, vp);
      const box = { left: bounds.left - pad, top: bounds.top - pad, right: bounds.right + pad, bottom: bounds.bottom + pad };
      const local = (p: Pt) => {
        const [x, y] = vp.convertToViewportPoint(p[0], p[1]);
        return `${(x - box.left).toFixed(1)},${(y - box.top).toFixed(1)}`;
      };
      let shape: ReactNode;
      let hit: ReactNode;
      if (a.kind === 'rect' || a.kind === 'ellipse') {
        const b = quadToBox(a.box as Quad, vp);
        const [x0, y0, x1, y1] = [b.left - box.left + width / 2, b.top - box.top + width / 2, b.right - box.left - width / 2, b.bottom - box.top - width / 2];
        const fill = a.fill ? 'var(--sf-annot-light)' : 'none';
        const geometry =
          a.kind === 'rect'
            ? { tag: 'rect' as const, props: { x: x0, y: y0, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0) } }
            : { tag: 'ellipse' as const, props: { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, rx: Math.max(0, (x1 - x0) / 2), ry: Math.max(0, (y1 - y0) / 2) } };
        const Tag = geometry.tag;
        shape = <Tag {...geometry.props} fill={fill} stroke="var(--sf-annot-ink)" strokeWidth={width} />;
        hit = <Tag {...geometry.props} className="sf-annot-hit" fill="transparent" stroke="transparent" strokeWidth={Math.max(width, 10)} />;
      } else {
        const lines: string[] =
          a.kind === 'ink'
            ? (a.paths ?? []).map((path) => (path.length === 1 ? [path[0], path[0]] : path).map(local).join(' '))
            : [[a.from as Pt, a.to as Pt].map(local).join(' '), ...(head.length ? [[head[0], a.to as Pt, head[1]].map(local).join(' ')] : [])];
        shape = lines.map((l, i) => <polyline key={i} points={l} fill="none" stroke="var(--sf-annot-ink)" strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" />);
        hit = lines.map((l, i) => <polyline key={`hit${i}`} className="sf-annot-hit" points={l} fill="none" stroke="transparent" strokeWidth={Math.max(width, 12)} strokeLinecap="round" />);
      }
      return (
        <svg
          key={key}
          className={`sf-annot sf-annot-svg sf-annot-${a.kind}`}
          style={{ ...style, ...at(box, where.x, where.y) }}
          width={box.right - box.left}
          height={box.bottom - box.top}
          {...common}
        >
          {shape}
          {!isDraft && hit}
        </svg>
      );
    }

    if (a.kind === 'reply') return null;

    // Each marked line is a click area; underlines and strikeouts also draw their line, the
    // same line the saved file has (along the text, even on a page turned sideways).
    const kind = a.kind;
    return (
      <span key={key} className={`sf-annot sf-annot-${kind}`} style={style} {...common}>
        {(a.quads ?? []).map((q, i) => (
          <span key={i} className="sf-annot-part" style={at(quadToBox(q, vp), where.x, where.y)} />
        ))}
        {(kind === 'underline' || kind === 'strikeout') &&
          (a.quads ?? []).map((q, i) => <span key={`line${i}`} className="sf-annot-line" style={at(markLineBox(q, kind, vp), where.x, where.y)} />)}
      </span>
    );
  };

  /** The corners (or ends) of the selected annotation, to drag. */
  const handles = (a: Annot, where: Placed): ReactNode => {
    if (!interactive || !movable(a)) return null;
    const vp = where.viewport;
    let spots: [Handle, number, number][];
    if (a.from && a.to) {
      const [fx, fy] = vp.convertToViewportPoint(...a.from);
      const [tx, ty] = vp.convertToViewportPoint(...a.to);
      spots = [
        ['from', fx, fy],
        ['to', tx, ty],
      ];
    } else {
      const b = a.box ? quadToBox(a.box, vp) : pointsToBox(annotPoints(a), vp);
      spots = [
        ['nw', b.left, b.top],
        ['ne', b.right, b.top],
        ['sw', b.left, b.bottom],
        ['se', b.right, b.bottom],
      ];
    }
    return spots.map(([handle, x, y]) => (
      <span
        key={`${a.id}-${handle}`}
        className="sf-annot-handle"
        data-handle={handle}
        aria-hidden="true"
        style={{ left: `${where.x + x}px`, top: `${where.y + y}px` }}
        onMouseDown={(e) => {
          if (e.button !== 0) return;
          e.stopPropagation();
          onGrab(a.id, e, handle);
        }}
      />
    ));
  };

  const redrawnIds = new Set(redrawn.map((a) => a.id));
  const selectedAnnot = annots.find((a) => a.id === selected);
  const selectedWhere = selectedAnnot ? place(selectedAnnot.page) : null;
  const draftWhere = draft ? place(draft.page) : null;

  return (
    <div className={`sf-annot-layer${interactive ? ' sf-annot-interactive' : ''}`} data-testid="annot-layer">
      {files.map((f) => {
        const id = `file:${f.id}`;
        if (redrawnIds.has(id)) return null;
        const where = place(f.page);
        if (!where) return null;
        const [x0, y0, x1, y1] = f.rect;
        const box = pointsToBox(
          [
            [x0, y0],
            [x1, y1],
          ],
          where.viewport,
        );
        const name = fileKindName(f);
        const by = f.author ? ` by ${f.author}` : '';
        return (
          <span
            key={id}
            className="sf-annot-file"
            data-kind="file"
            style={at(box, where.x, where.y)}
            {...interactions(id, `${name}${by} on page ${f.page + 1}${f.contents ? `: ${f.contents}` : ''}`, f.contents || name, false)}
          />
        );
      })}
      {redrawn.map((a) => {
        const where = place(a.page);
        return where ? drawAnnot({ ...a }, where) : null;
      })}
      {annots.map((a) => {
        const where = place(a.page);
        return where ? drawAnnot(a, where) : null;
      })}
      {draft && draftWhere && drawAnnot(draft, draftWhere, true)}
      {selectedAnnot && selectedWhere && handles(selectedAnnot, selectedWhere)}
    </div>
  );
}
