// Line icons drawn in the current text colour. The logo is ScribeForge's quill crossing an
// anvil (first draft, docs/phase0/icon-draft.svg).

import { PATHS, type IconName } from './iconPaths';

export type { IconName };

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
