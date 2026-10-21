// The fixed annotation palette. These colours are part of the document, not the screen's theme:
// they're saved in the PDF and must read well on a white page and on paper. This is the only
// file besides themes.ts that holds colour values (build prompt, section 4).
//
// `highlight` is the light colour laid over text (multiplied, so the text stays dark).
// `ink` is the strong colour for underlines, strikeouts, note icons and text boxes; every ink
// colour has at least 4.5:1 contrast on white (tested).

export interface AnnotationColour {
  id: string;
  name: string;
  highlight: string;
  ink: string;
}

export const ANNOTATION_COLOURS: readonly AnnotationColour[] = [
  { id: 'yellow', name: 'Yellow', highlight: '#FFE45C', ink: '#7A5F00' },
  { id: 'green', name: 'Green', highlight: '#9BE58F', ink: '#1E6B30' },
  { id: 'blue', name: 'Blue', highlight: '#9CCBFF', ink: '#1C5BB0' },
  { id: 'pink', name: 'Pink', highlight: '#FFA8CF', ink: '#A3215F' },
  { id: 'orange', name: 'Orange', highlight: '#FFBF7A', ink: '#9A4300' },
  { id: 'red', name: 'Red', highlight: '#FF9C9C', ink: '#B71C1C' },
];

export const DEFAULT_ANNOTATION_COLOUR = 'yellow';

export function annotationColour(id: string): AnnotationColour {
  return ANNOTATION_COLOURS.find((c) => c.id === id) ?? ANNOTATION_COLOURS[0];
}

/** "#RRGGBB" → [r, g, b] from 0 to 1, as PDF colours are written. */
export function pdfColour(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => Math.round((parseInt(h.slice(i, i + 2), 16) / 255) * 1000) / 1000) as [number, number, number];
}

/**
 * Redaction: the page behind a redacted page's image and the boxes burned into it; on screen,
 * marks show as see-through black with a red edge until they're applied.
 */
export const REDACTION_COLOURS = { paper: '#FFFFFF', box: '#000000', outline: '#B71C1C' } as const;
