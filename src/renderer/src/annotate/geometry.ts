// Screen ↔ PDF geometry for annotations. A pdf.js page viewport converts between a point on the
// shown page (pixels from its top-left) and a point in the PDF page's own space.
import { MARK_LINE_AT, markLineWidth } from '../../../engine/marks';
import type { Pt, Quad } from '../../../engine/types';

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Viewport {
  scale: number;
  convertToPdfPoint(x: number, y: number): number[];
  convertToViewportPoint(x: number, y: number): number[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Turns the many small rectangles a text selection is made of into one box per line: rectangles
 * on the same line that touch or nearly touch are joined. Stray rectangles much taller than the
 * text (such as the end-of-page marker pdf.js adds) are dropped.
 */
export function mergeLineRects(rects: Box[]): Box[] {
  const usable = rects.filter((r) => r.right - r.left > 0.5 && r.bottom - r.top > 0.5);
  if (usable.length === 0) return [];
  const heights = usable.map((r) => r.bottom - r.top).sort((a, b) => a - b);
  const median = heights[Math.floor((heights.length - 1) / 2)];
  const sorted = usable.filter((r) => r.bottom - r.top <= median * 2.5).sort((a, b) => a.top - b.top || a.left - b.left);

  const lines: Box[][] = [];
  for (const r of sorted) {
    const line = lines.find((l) => {
      const ref = l[0];
      const overlap = Math.min(ref.bottom, r.bottom) - Math.max(ref.top, r.top);
      return overlap > 0.5 * Math.min(ref.bottom - ref.top, r.bottom - r.top);
    });
    if (line) line.push(r);
    else lines.push([r]);
  }

  const out: Box[] = [];
  for (const line of lines) {
    line.sort((a, b) => a.left - b.left);
    let current = { ...line[0] };
    for (const r of line.slice(1)) {
      const gap = r.left - current.right;
      if (gap <= 0.5 * (current.bottom - current.top)) {
        current = { left: Math.min(current.left, r.left), top: Math.min(current.top, r.top), right: Math.max(current.right, r.right), bottom: Math.max(current.bottom, r.bottom) };
      } else {
        out.push(current);
        current = { ...r };
      }
    }
    out.push(current);
  }
  return out;
}

/** A box on the shown page (pixels) → its four corners in PDF space, in reading order. */
export function boxToQuad(box: Box, viewport: Viewport): Quad {
  const ul = viewport.convertToPdfPoint(box.left, box.top);
  const ur = viewport.convertToPdfPoint(box.right, box.top);
  const ll = viewport.convertToPdfPoint(box.left, box.bottom);
  const lr = viewport.convertToPdfPoint(box.right, box.bottom);
  return [ul[0], ul[1], ur[0], ur[1], ll[0], ll[1], lr[0], lr[1]].map(round2) as Quad;
}

/**
 * A text selection's rectangles on one page (pixels on the shown page) → one quad per line, in
 * PDF space. Lines are found in the page's own unturned space, where text normally runs left to
 * right, so on a page turned sideways in the file they run along the text, not across it. Each
 * quad's corners are the text's upper-left, upper-right, lower-left and lower-right.
 */
export function selectionQuads(rects: Box[], viewport: Viewport): Quad[] {
  const inPdf = rects.map((r) => {
    const [x1, y1] = viewport.convertToPdfPoint(r.left, r.top);
    const [x2, y2] = viewport.convertToPdfPoint(r.right, r.bottom);
    // PDF y grows upwards; negated here so "top" is smaller than "bottom", as on screen.
    return { left: Math.min(x1, x2), right: Math.max(x1, x2), top: -Math.max(y1, y2), bottom: -Math.min(y1, y2) };
  });
  return mergeLineRects(inPdf).map((b) => [b.left, -b.top, b.right, -b.top, b.left, -b.bottom, b.right, -b.bottom].map(round2) as Quad);
}

/**
 * Where an underline or strikeout line is drawn on the shown page (pixels): the same line the
 * saved file draws, from the quad's left edge to its right edge, at least 1 pixel thick.
 */
export function markLineBox(quad: Quad, kind: keyof typeof MARK_LINE_AT, viewport: Viewport): Box {
  const [ulx, uly, urx, ury, llx, lly, lrx, lry] = quad;
  const t = MARK_LINE_AT[kind];
  const height = Math.hypot(llx - ulx, lly - uly);
  const half = markLineWidth(height) / 2;
  // Unit vector from the top edge towards the bottom edge.
  const nx = height ? (llx - ulx) / height : 0;
  const ny = height ? (lly - uly) / height : -1;
  const a = [ulx + (llx - ulx) * t, uly + (lly - uly) * t];
  const b = [urx + (lrx - urx) * t, ury + (lry - ury) * t];
  const corners = [
    [a[0] - nx * half, a[1] - ny * half],
    [a[0] + nx * half, a[1] + ny * half],
    [b[0] - nx * half, b[1] - ny * half],
    [b[0] + nx * half, b[1] + ny * half],
  ].map(([x, y]) => viewport.convertToViewportPoint(x, y));
  const xs = corners.map((p) => p[0]);
  const ys = corners.map((p) => p[1]);
  const box = { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) };
  if (box.right - box.left < 1) box.right = box.left + 1;
  if (box.bottom - box.top < 1) box.bottom = box.top + 1;
  return box;
}

/** A PDF quad → the box it covers on the shown page (pixels). */
export function quadToBox(quad: Quad, viewport: Viewport): Box {
  const points = [0, 2, 4, 6].map((i) => viewport.convertToViewportPoint(quad[i], quad[i + 1]));
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) };
}

/** A box `width` × `height` PDF points whose top-left is at (x, y) on the shown page. */
export function boxAt(x: number, y: number, width: number, height: number, viewport: Viewport): Quad {
  return boxToQuad({ left: x, top: y, right: x + width * viewport.scale, bottom: y + height * viewport.scale }, viewport);
}

/** PDF points → the box they cover on the shown page (pixels). */
export function pointsToBox(points: Pt[], viewport: Viewport): Box {
  const shown = points.map(([x, y]) => viewport.convertToViewportPoint(x, y));
  const xs = shown.map((p) => p[0]);
  const ys = shown.map((p) => p[1]);
  return { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) };
}

/** A box on the shown page (pixels) → its bounds in PDF space, as [x0, y0, x1, y1]. */
export function boxToBounds(box: Box, viewport: Viewport): number[] {
  const a = viewport.convertToPdfPoint(box.left, box.top);
  const b = viewport.convertToPdfPoint(box.right, box.bottom);
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
}
