import type { Pt } from './types';

// Where underline and strikeout lines sit on the text they mark, and the shape of an arrowhead.
// Shared by the saved file and the screen, so both draw the same thing.

/** How far across the marked text the line runs: 0 is the top of the letters, 1 the bottom. */
export const MARK_LINE_AT = { underline: 0.92, strikeout: 0.55 } as const;

/** Line thickness for text `height` points tall. */
export const markLineWidth = (height: number): number => Math.max(0.75, height * 0.07);

/** The two short lines of an open arrowhead at `to`, pointing away from `from`. */
export function arrowHead(from: Pt, to: Pt, width: number): [Pt, Pt] {
  const length = Math.max(6, width * 4);
  const angle = Math.atan2(to[1] - from[1], to[0] - from[0]);
  const spread = Math.PI / 6;
  return [
    [to[0] - length * Math.cos(angle - spread), to[1] - length * Math.sin(angle - spread)],
    [to[0] - length * Math.cos(angle + spread), to[1] - length * Math.sin(angle + spread)],
  ];
}
