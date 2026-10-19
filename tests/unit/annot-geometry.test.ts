import { describe, expect, it } from 'vitest';
import { boxAt, boxToQuad, markLineBox, mergeLineRects, quadToBox, selectionQuads, type Box, type Viewport } from '../../src/renderer/src/annotate/geometry';

const r = (left: number, top: number, right: number, bottom: number): Box => ({ left, top, right, bottom });

/** A letter-size page (612 × 792) shown at `scale`, turned by `rotation`, like pdf.js does. */
function viewport(scale: number, rotation: 0 | 90): Viewport {
  const w = 612;
  const h = 792;
  return {
    scale,
    convertToViewportPoint: (x, y) => (rotation === 0 ? [x * scale, (h - y) * scale] : [y * scale, x * scale]),
    convertToPdfPoint: (vx, vy) => (rotation === 0 ? [vx / scale, h - vy / scale] : [vy / scale, vx / scale]),
  };
  void w;
}

describe('selection to line boxes', () => {
  it('joins the pieces of one line and keeps separate lines apart', () => {
    const boxes = mergeLineRects([r(10, 100, 50, 114), r(52, 100, 90, 114), r(10, 118, 60, 132), r(150, 100, 200, 114)]);
    expect(boxes).toEqual([r(10, 100, 90, 114), r(150, 100, 200, 114), r(10, 118, 60, 132)]);
  });

  it('drops empty pieces and pieces far taller than the text', () => {
    expect(mergeLineRects([r(10, 100, 50, 114), r(0, 0, 600, 800), r(5, 5, 5, 5)])).toEqual([r(10, 100, 50, 114)]);
    expect(mergeLineRects([])).toEqual([]);
  });

  it('joins pieces of slightly different heights on the same line', () => {
    expect(mergeLineRects([r(10, 100, 50, 114), r(51, 99, 70, 115)])).toEqual([r(10, 99, 70, 115)]);
  });
});

describe('screen ↔ PDF', () => {
  it('a box on an upright page becomes corners in reading order, and back', () => {
    const vp = viewport(2, 0);
    const quad = boxToQuad(r(108, 76, 308, 104), vp);
    expect(quad).toEqual([54, 754, 154, 754, 54, 740, 154, 740]);
    expect(quadToBox(quad, vp)).toEqual(r(108, 76, 308, 104));
  });

  it('on a turned page, the corners follow the text as shown', () => {
    const vp = viewport(1, 90);
    const quad = boxToQuad(r(100, 50, 200, 64), vp);
    // Upper-left as shown is (100, 50) on screen, which is (50, 100) on the page.
    expect(quad.slice(0, 2)).toEqual([50, 100]);
    expect(quadToBox(quad, vp)).toEqual(r(100, 50, 200, 64));
  });

  it('places a fixed-size box (in PDF points) at a point, at any zoom', () => {
    expect(boxAt(100, 100, 24, 24, viewport(2, 0))).toEqual([50, 742, 74, 742, 50, 718, 74, 718]);
  });
});

describe('marked lines follow the text, on upright and turned pages', () => {
  // The same text, "upright" in the PDF page's own space: x 54 to 154, y 740 to 754.
  const TEXT_QUAD = [54, 754, 154, 754, 54, 740, 154, 740];

  it('upright page: one quad per line, and the underline runs across near the bottom', () => {
    const vp = viewport(2, 0);
    const [quad] = selectionQuads([r(108, 76, 308, 104)], vp);
    expect(quad).toEqual(TEXT_QUAD);
    const line = markLineBox(quad, 'underline', vp);
    expect(line.right - line.left).toBeCloseTo(200);
    expect(line.bottom - line.top).toBeLessThan(4);
    expect((line.top + line.bottom) / 2).toBeCloseTo(76 + 28 * 0.92, 0);
    const strike = markLineBox(quad, 'strikeout', vp);
    expect((strike.top + strike.bottom) / 2).toBeCloseTo(76 + 28 * 0.55, 0);
  });

  it('page turned 90°: the text reads down the screen, and the underline runs down beside it', () => {
    const vp = viewport(2, 90);
    // On screen the text is a tall, narrow box; the bottoms of the letters face left.
    const [quad] = selectionQuads([r(1480, 108, 1508, 308)], vp);
    expect(quad).toEqual(TEXT_QUAD);
    const line = markLineBox(quad, 'underline', vp);
    expect(line.bottom - line.top).toBeCloseTo(200);
    expect(line.right - line.left).toBeLessThan(4);
    expect((line.left + line.right) / 2).toBeCloseTo(1480 + 28 * (1 - 0.92), 0);
  });

  it('page turned 90°: pieces of one line join, and lines of different lengths are all kept', () => {
    const vp = viewport(2, 90);
    const quads = selectionQuads([r(1480, 108, 1508, 200), r(1480, 202, 1508, 308), r(1440, 108, 1468, 140)], vp);
    expect(quads).toEqual([TEXT_QUAD, [54, 734, 70, 734, 54, 720, 70, 720]]);
  });

  it('lines are at least a pixel thick, even when zoomed far out', () => {
    const vp = viewport(0.1, 0);
    const line = markLineBox([54, 754, 154, 754, 54, 740, 154, 740], 'underline', vp);
    expect(line.bottom - line.top).toBeGreaterThanOrEqual(1);
  });
});
