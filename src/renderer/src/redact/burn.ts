// Turns a marked page into an image with its marks blacked out (Phase 0 plan, section 9). The
// image replaces the page in the redacted file, so nothing that was on it survives as text.
//
// Works with any canvas: the app's (OffscreenCanvas) and Node's (for the unit tests).
import type { PDFPageProxy } from 'pdfjs-dist';
import type { Rect, RedactedPage } from '../../../engine/types';
import { REDACTION_COLOURS } from '../../../shared/annotationColours';

/** A drawing surface and a way to save it as PNG. */
export interface Surface {
  /** pdf.js asks for a page canvas; an OffscreenCanvas (or Node's canvas) works the same. */
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  png(): Promise<Uint8Array>;
}

export type MakeSurface = (width: number, height: number) => Surface;

/** Largest image made for one page, in pixels. Bigger pages are drawn at a lower resolution. */
export const MAX_PIXELS = 60_000_000;

/** The resolution a page is actually drawn at: the chosen one, unless that would be too big. */
export function dpiFor(view: number[], dpi: number): number {
  const widthIn = Math.abs(view[2] - view[0]) / 72;
  const heightIn = Math.abs(view[3] - view[1]) / 72;
  const pixels = widthIn * heightIn * dpi * dpi;
  return pixels <= MAX_PIXELS ? dpi : Math.floor(Math.sqrt(MAX_PIXELS / (widthIn * heightIn)));
}

/**
 * Draws the page upright as it is in its file (its own rotation is put back on the new page),
 * without comments or form fields, then fills every mark solid black. Mark edges are rounded
 * outwards to whole pixels so no half-covered pixel can show part of a letter.
 */
export async function burnPage(page: PDFPageProxy, marks: Rect[], dpi: number, make: MakeSurface, annotationsOff: number): Promise<RedactedPage> {
  const used = dpiFor(page.view, dpi);
  const viewport = page.getViewport({ scale: used / 72, rotation: 0 });
  const width = Math.ceil(viewport.width);
  const height = Math.ceil(viewport.height);
  const surface = make(width, height);
  const ctx = surface.context;
  ctx.fillStyle = REDACTION_COLOURS.paper;
  ctx.fillRect(0, 0, width, height);
  await page.render({ canvasContext: ctx, canvas: surface.canvas, viewport, annotationMode: annotationsOff }).promise;
  ctx.fillStyle = REDACTION_COLOURS.box;
  for (const [x0, y0, x1, y1] of marks) {
    const corners = [viewport.convertToViewportPoint(x0, y0), viewport.convertToViewportPoint(x1, y1)];
    const left = Math.max(0, Math.floor(Math.min(corners[0][0], corners[1][0])));
    const top = Math.max(0, Math.floor(Math.min(corners[0][1], corners[1][1])));
    const right = Math.min(width, Math.ceil(Math.max(corners[0][0], corners[1][0])));
    const bottom = Math.min(height, Math.ceil(Math.max(corners[0][1], corners[1][1])));
    if (right > left && bottom > top) ctx.fillRect(left, top, right - left, bottom - top);
  }
  return { png: await surface.png(), view: page.view.slice(0, 4) as Rect, dpi: used };
}
