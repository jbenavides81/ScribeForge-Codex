import type { Settings } from '../../shared/settings';
import { cssVariables, presetFor } from '../../shared/themes';

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

export function systemPrefersDark(): boolean {
  return darkQuery.matches;
}

/** Applies the theme and text size to the whole window. */
export function applyAppearance(settings: Settings): void {
  const preset = presetFor(settings.theme, systemPrefersDark());
  const root = document.documentElement;
  for (const [name, value] of Object.entries(cssVariables(preset.tokens))) root.style.setProperty(name, value);
  root.dataset.theme = preset.id;
  root.dataset.textSize = settings.textSize;
  root.style.colorScheme = preset.scheme;
}

export function onSystemThemeChange(listener: () => void): () => void {
  darkQuery.addEventListener('change', listener);
  return () => darkQuery.removeEventListener('change', listener);
}
