import type { CSSProperties } from 'react';
import type { SettingsChange } from '../../../shared/api';
import type { Settings as AppSettings, TextSize } from '../../../shared/settings';
import { cssVariables, presetFor, THEME_CHOICES, type ThemeId } from '../../../shared/themes';

const TEXT_SIZES: { id: TextSize; name: string }[] = [
  { id: 'standard', name: 'Standard' },
  { id: 'large', name: 'Large' },
  { id: 'larger', name: 'Larger' },
];

function Preview({ theme }: { theme: ThemeId }) {
  const halves = theme === 'system' ? [presetFor('system', false), presetFor('system', true)] : [presetFor(theme, false)];
  return (
    <span className="sf-preview" aria-hidden="true">
      {halves.map((preset) => (
        <span key={preset.id} className="sf-preview-half" style={cssVariables(preset.tokens) as CSSProperties}>
          <span className="sf-preview-bar" />
          <span className="sf-preview-line" />
          <span className="sf-preview-line sf-preview-short" />
          <span className="sf-preview-button" />
        </span>
      ))}
    </span>
  );
}

export function Settings({
  settings,
  onChange,
  onClearRecent,
}: {
  settings: AppSettings;
  onChange: (change: SettingsChange) => void;
  onClearRecent: () => void;
}) {
  return (
    <div className="sf-screen">
      <h1>Settings</h1>
      <p className="sf-muted">Changes apply straight away and are saved on this computer.</p>

      <fieldset className="sf-section">
        <legend>
          <h2>Theme</h2>
        </legend>
        <div className="sf-theme-grid" data-testid="theme-choices">
          {THEME_CHOICES.map((choice) => (
            <label key={choice.id} className="sf-theme-card" data-selected={settings.theme === choice.id}>
              <input
                type="radio"
                name="theme"
                value={choice.id}
                checked={settings.theme === choice.id}
                onChange={() => onChange({ theme: choice.id })}
              />
              <Preview theme={choice.id} />
              <span className="sf-theme-name">{choice.name}</span>
              <span className="sf-muted">{choice.description}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="sf-section">
        <legend>
          <h2>Text size</h2>
        </legend>
        <div className="sf-choice-row">
          {TEXT_SIZES.map((size) => (
            <label key={size.id} className="sf-choice">
              <input
                type="radio"
                name="text-size"
                value={size.id}
                checked={settings.textSize === size.id}
                onChange={() => onChange({ textSize: size.id })}
              />
              {size.name}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="sf-section">
        <legend>
          <h2>Recent files</h2>
        </legend>
        <label className="sf-choice">
          <input
            type="checkbox"
            checked={settings.rememberRecent}
            onChange={(e) => onChange({ rememberRecent: e.target.checked })}
          />
          Remember the files I open
        </label>
        <p className="sf-muted">File names can be private. Turning this off also clears the list.</p>
        <button type="button" className="sf-button" onClick={onClearRecent} disabled={settings.recentFiles.length === 0}>
          Clear the list now
        </button>
      </fieldset>
    </div>
  );
}
