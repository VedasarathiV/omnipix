import { describe, expect, it } from 'vitest';
import { resolveDark, type ThemePref } from '../../lib/theme.js';

describe('resolveDark', () => {
  it('pins the theme matrix', () => {
    const cases: Array<[ThemePref, boolean, boolean]> = [
      ['dark', true, true],
      ['dark', false, true],
      ['light', true, false],
      ['light', false, false],
      ['system', true, true],
      ['system', false, false],
    ];
    for (const [pref, systemDark, dark] of cases) {
      expect(resolveDark(pref, systemDark)).toBe(dark);
    }
  });
});
