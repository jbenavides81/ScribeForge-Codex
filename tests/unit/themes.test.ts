import { describe, expect, it } from 'vitest';
import { contrastPairs, contrastRatio, cssVariables, PRESETS, presetFor, THEME_CHOICES } from '../../src/shared/themes';

describe('contrast', () => {
  it('matches known WCAG values', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio('#1A4C8B', '#0F0F11')).toBeCloseTo(2.23, 2);
    expect(contrastRatio('#C7C9CC', '#0F0F11')).toBeCloseTo(11.54, 2);
  });

  for (const preset of PRESETS) {
    it(`${preset.name}: every text and control pairing passes (4.5:1 text, 3:1 outlines)`, () => {
      const failures = contrastPairs()
        .map(([fg, bg, min]) => ({ fg, bg, min, ratio: contrastRatio(preset.tokens[fg], preset.tokens[bg]) }))
        .filter((c) => c.ratio < c.min)
        .map((c) => `${c.fg} on ${c.bg}: ${c.ratio.toFixed(2)} (needs ${c.min})`);
      expect(failures).toEqual([]);
    });
  }

  it('checks every pairing on every preset (count)', () => {
    expect(contrastPairs().length * PRESETS.length).toBe(23 * 4);
  });
});

describe('presets', () => {
  it('Cathedral uses the outline palette', () => {
    const c = PRESETS.find((p) => p.id === 'cathedral')!.tokens;
    expect([c.bg, c.text, c.accent, c.buttonBg]).toEqual(['#0F0F11', '#C7C9CC', '#D9A441', '#1A4C8B']);
  });

  it('every preset defines every token as a hex colour', () => {
    const keys = Object.keys(PRESETS[0].tokens).sort();
    for (const p of PRESETS) {
      expect(Object.keys(p.tokens).sort()).toEqual(keys);
      for (const v of Object.values(p.tokens)) expect(v).toMatch(/^#[0-9A-F]{6}([0-9A-F]{2})?$/);
    }
  });

  it('Match system follows Windows', () => {
    expect(presetFor('system', true).id).toBe('dark');
    expect(presetFor('system', false).id).toBe('light');
    expect(presetFor('cathedral', false).id).toBe('cathedral');
  });

  it('offers the four presets plus Match system', () => {
    expect(THEME_CHOICES.map((t) => t.id)).toEqual(['cathedral', 'light', 'dark', 'high-contrast', 'system']);
  });

  it('turns token names into CSS variable names', () => {
    const vars = cssVariables(PRESETS[0].tokens);
    expect(vars['--sf-bg']).toBe('#0F0F11');
    expect(vars['--sf-button-bg']).toBe('#1A4C8B');
    expect(vars['--sf-selection-text']).toBe('#FFFFFF');
  });
});
