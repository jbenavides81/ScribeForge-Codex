// Line icons drawn in the current text colour. The logo is ScribeForge's quill crossing an
// anvil (first draft, docs/phase0/icon-draft.svg).

export type IconName =
  | 'logo'
  | 'open'
  | 'document'
  | 'settings'
  | 'about'
  | 'previous'
  | 'next'
  | 'zoom-in'
  | 'zoom-out'
  | 'thumbnails'
  | 'search'
  | 'close'
  | 'remove';

const PATHS: Record<IconName, string[]> = {
  logo: [
    'M5 27 C 10 27 13 29 16 31 L16 35 C 20 35 24 37 25 41 L22 47 L17 49 L17 52 L47 52 L47 49 L42 47 L39 41 C 40 37 44 35 50 35 L57 35 L57 27 Z',
    'M58 5 C 46 9 36 17 29 28 C 34 27 38 25 41 22 C 38 26 35 29 31 31 C 40 29 49 21 58 5 Z',
    'M29 28 L14 58',
  ],
  open: ['M6 18 V48 a4 4 0 0 0 4 4 H54 a4 4 0 0 0 4 -4 V24 a4 4 0 0 0 -4 -4 H32 L26 13 H10 a4 4 0 0 0 -4 4 Z'],
  document: ['M16 6 H38 L50 18 V58 H16 Z', 'M38 6 V18 H50', 'M24 30 H42', 'M24 38 H42', 'M24 46 H36'],
  settings: [
    'M32 22 a10 10 0 1 0 0.01 0 Z',
    'M32 4 V12 M32 52 V60 M4 32 H12 M52 32 H60 M12.2 12.2 L17.9 17.9 M46.1 46.1 L51.8 51.8 M12.2 51.8 L17.9 46.1 M46.1 17.9 L51.8 12.2',
  ],
  about: ['M32 6 a26 26 0 1 0 0.01 0 Z', 'M32 28 V46', 'M32 18 V19'],
  previous: ['M40 12 L20 32 L40 52'],
  next: ['M24 12 L44 32 L24 52'],
  'zoom-in': ['M28 8 a20 20 0 1 0 0.01 0 Z', 'M42 42 L58 58', 'M20 28 H36', 'M28 20 V36'],
  'zoom-out': ['M28 8 a20 20 0 1 0 0.01 0 Z', 'M42 42 L58 58', 'M20 28 H36'],
  thumbnails: ['M8 8 H56 V56 H8 Z', 'M24 8 V56'],
  search: ['M28 8 a20 20 0 1 0 0.01 0 Z', 'M42 42 L58 58'],
  close: ['M14 14 L50 50', 'M50 14 L14 50'],
  remove: ['M14 14 L50 50', 'M50 14 L14 50'],
};

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="sf-icon"
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      stroke="currentColor"
      strokeWidth={name === 'logo' ? 3 : 4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
