import { describe, expect, it } from 'vitest';
import { pageOf, pageParams } from '../../lib/pagination.js';

describe('pageParams', () => {
  it('is unpaged without params and clamps leniently with them', () => {
    expect(pageParams({})).toEqual({ limit: 100, offset: 0, paged: false });
    expect(pageParams({ limit: '10', offset: '20' })).toEqual({ limit: 10, offset: 20, paged: true });
    expect(pageParams({ offset: '5' })).toMatchObject({ limit: 100, offset: 5, paged: true });
    // Lenient like analytics: garbage coerces, extremes clamp, arrays take first.
    expect(pageParams({ limit: 'abc' })).toMatchObject({ limit: 100, paged: true });
    expect(pageParams({ limit: '9999' })).toMatchObject({ limit: 500 });
    expect(pageParams({ limit: '0' })).toMatchObject({ limit: 100 });
    expect(pageParams({ offset: '-3' })).toMatchObject({ offset: 0 });
    expect(pageParams({ limit: ['7', '9'] })).toMatchObject({ limit: 7 });
  });
});

describe('pageOf', () => {
  const rows = [1, 2, 3, 4, 5];
  it('slices rows and reports the total', () => {
    expect(pageOf(rows, { limit: 2, offset: 1, paged: true })).toEqual({
      total: 5, limit: 2, offset: 1, rows: [2, 3],
    });
    expect(pageOf(rows, { limit: 100, offset: 0, paged: false })).toEqual({
      total: 5, limit: 100, offset: 0, rows,
    });
    expect(pageOf(rows, { limit: 2, offset: 99, paged: true }).rows).toEqual([]);
  });
});
