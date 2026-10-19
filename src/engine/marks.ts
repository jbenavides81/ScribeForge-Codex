// Where underline and strikeout lines sit on the text they mark. Shared by the saved file and
// the screen, so both draw the same line.

/** How far across the marked text the line runs: 0 is the top of the letters, 1 the bottom. */
export const MARK_LINE_AT = { underline: 0.92, strikeout: 0.55 } as const;

/** Line thickness for text `height` points tall. */
export const markLineWidth = (height: number): number => Math.max(0.75, height * 0.07);
