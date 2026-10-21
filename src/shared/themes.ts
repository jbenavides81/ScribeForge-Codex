// The only file in the app allowed to contain colour values (the style-guard test enforces it).
// Every screen uses these through CSS variables named --sf-<token>.
//
// Interim presets: BC6 Business Manager's 7 presets replace Light and Dark once the BC6 repo
// can be read here (Phase 0 plan, question 1). Cathedral and High Contrast stay.

export type PresetId = 'cathedral' | 'light' | 'dark' | 'high-contrast';
export type ThemeId = PresetId | 'system';

export interface ThemeTokens {
  bg: string; // window background
  panel: string; // panels, cards, toolbars
  raised: string; // inputs, hovered rows, selected items
  text: string;
  muted: string; // secondary text
  accent: string; // headings, the logo, highlights
  link: string; // links and focus rings
  outline: string; // input and control outlines
  line: string; // dividers (decorative)
  error: string;
  buttonBg: string;
  buttonText: string;
  buttonOutline: string;
  selection: string; // selected text background
  selectionText: string;
  pageBack: string; // behind the document's pages
  pageFocus: string; // outlines drawn on a page (a selected annotation or mark), always on white
  scrim: string; // behind dialogs
}

export interface ThemePreset {
  id: PresetId;
  name: string;
  description: string;
  scheme: 'light' | 'dark';
  tokens: ThemeTokens;
}

export const PRESETS: readonly ThemePreset[] = [
  {
    id: 'cathedral',
    name: 'Cathedral',
    description: 'Obsidian, forge steel and runic gold',
    scheme: 'dark',
    tokens: {
      bg: '#0F0F11',
      panel: '#18191D',
      raised: '#22242A',
      text: '#C7C9CC',
      muted: '#9A9DA3',
      accent: '#D9A441',
      link: '#5B8FD9',
      outline: '#6E737C',
      line: '#2C2E35',
      error: '#F08A80',
      buttonBg: '#1A4C8B',
      buttonText: '#FFFFFF',
      buttonOutline: '#5B8FD9',
      selection: '#2F4B73',
      selectionText: '#FFFFFF',
      pageBack: '#0B0B0D',
      pageFocus: '#1A4C8B',
      scrim: '#000000B3',
    },
  },
  {
    id: 'light',
    name: 'Light',
    description: 'Dark text on a light background',
    scheme: 'light',
    tokens: {
      bg: '#F4F4F2',
      panel: '#FFFFFF',
      raised: '#E9EAEC',
      text: '#1C1D21',
      muted: '#55585F',
      accent: '#7A5000',
      link: '#1A4C8B',
      outline: '#767A82',
      line: '#D9DBDF',
      error: '#B42318',
      buttonBg: '#1A4C8B',
      buttonText: '#FFFFFF',
      buttonOutline: '#1A4C8B',
      selection: '#C9DAF2',
      selectionText: '#1C1D21',
      pageBack: '#DFE0E3',
      pageFocus: '#1A4C8B',
      scrim: '#00000080',
    },
  },
  {
    id: 'dark',
    name: 'Dark',
    description: 'Light text on a dark grey background',
    scheme: 'dark',
    tokens: {
      bg: '#1B1C1F',
      panel: '#232428',
      raised: '#2D2F34',
      text: '#E6E7EA',
      muted: '#A5A8AF',
      accent: '#E3B45A',
      link: '#8DB4F0',
      outline: '#7C8089',
      line: '#383A40',
      error: '#F2938A',
      buttonBg: '#2A5FAD',
      buttonText: '#FFFFFF',
      buttonOutline: '#8DB4F0',
      selection: '#33507A',
      selectionText: '#FFFFFF',
      pageBack: '#141517',
      pageFocus: '#1A4C8B',
      scrim: '#000000B3',
    },
  },
  {
    id: 'high-contrast',
    name: 'High Contrast',
    description: 'White and yellow on black',
    scheme: 'dark',
    tokens: {
      bg: '#000000',
      panel: '#000000',
      raised: '#121212',
      text: '#FFFFFF',
      muted: '#E6E6E6',
      accent: '#FFD500',
      link: '#7FD4FF',
      outline: '#FFFFFF',
      line: '#FFFFFF',
      error: '#FF8A80',
      buttonBg: '#FFD500',
      buttonText: '#000000',
      buttonOutline: '#FFFFFF',
      selection: '#FFD500',
      selectionText: '#000000',
      pageBack: '#000000',
      pageFocus: '#000000',
      scrim: '#000000CC',
    },
  },
];

export const THEME_CHOICES: readonly { id: ThemeId; name: string; description: string }[] = [
  ...PRESETS.map(({ id, name, description }) => ({ id, name, description })),
  { id: 'system', name: 'Match system', description: 'Light or Dark, following Windows' },
];

export function presetFor(theme: ThemeId, systemPrefersDark: boolean): ThemePreset {
  const id: PresetId = theme === 'system' ? (systemPrefersDark ? 'dark' : 'light') : theme;
  return PRESETS.find((p) => p.id === id) ?? PRESETS[0];
}

/** CSS custom properties for a preset, e.g. { '--sf-bg': '#0F0F11', ... } */
export function cssVariables(tokens: ThemeTokens): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const [key, value] of Object.entries(tokens)) {
    vars[`--sf-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`] = value;
  }
  return vars;
}

// ---- contrast (WCAG 2) ----

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** The pairs every preset must pass: [foreground, background, minimum ratio]. */
export function contrastPairs(): [keyof ThemeTokens, keyof ThemeTokens, number][] {
  const pairs: [keyof ThemeTokens, keyof ThemeTokens, number][] = [];
  for (const surface of ['bg', 'panel', 'raised'] as const) {
    for (const fg of ['text', 'muted', 'accent', 'link', 'error'] as const) pairs.push([fg, surface, 4.5]);
    pairs.push(['outline', surface, 3], ['buttonOutline', surface, 3]);
  }
  pairs.push(['buttonText', 'buttonBg', 4.5], ['selectionText', 'selection', 4.5]);
  return pairs;
}
