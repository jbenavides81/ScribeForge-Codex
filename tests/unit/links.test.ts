import { describe, expect, it } from 'vitest';
import { isOpenableLink } from '../../src/shared/links';

describe('web links inside PDFs', () => {
  it('allows ordinary web and email links', () => {
    for (const a of ['https://example.com/page', 'http://example.com', 'mailto:someone@example.com']) {
      expect(isOpenableLink(a)).toBe(true);
    }
  });

  it('refuses everything else', () => {
    for (const a of [
      'javascript:alert(1)',
      'file:///C:/Windows/System32/calc.exe',
      'C:\\Windows\\System32\\calc.exe',
      '\\\\server\\share\\file.exe',
      'smb://server/share',
      'ms-settings:',
      'search-ms:query=x',
      'vbscript:msgbox(1)',
      'data:text/html,<script>alert(1)</script>',
      'http://',
      'not a link',
      '',
    ]) {
      expect(isOpenableLink(a), a).toBe(false);
    }
  });
});
