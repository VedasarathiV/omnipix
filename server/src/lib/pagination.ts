// Shared opt-in pagination for admin list routes. Mirrors the analytics
// convention (lenient clamp, limit 1..500): when neither ?limit nor ?offset
// is present the route keeps its legacy bare-array shape, so existing
// clients are unaffected; when either is present the route returns an
// envelope { total, limit, offset, rows }.

export interface PageParams {
  limit: number;
  offset: number;
  /** True when the caller asked for a page (either param present). */
  paged: boolean;
}

function firstParam(value: unknown): string | undefined {
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : undefined;
  return typeof value === 'string' ? value : undefined;
}

export function pageParams(query: Record<string, unknown>): PageParams {
  const rawLimit = firstParam(query.limit);
  const rawOffset = firstParam(query.offset);
  return {
    limit: Math.min(Math.max(parseInt(rawLimit ?? '', 10) || 100, 1), 500),
    offset: Math.max(parseInt(rawOffset ?? '', 10) || 0, 0),
    paged: rawLimit !== undefined || rawOffset !== undefined,
  };
}

export function pageOf<T>(rows: T[], params: PageParams): { total: number; limit: number; offset: number; rows: T[] } {
  return {
    total: rows.length,
    limit: params.limit,
    offset: params.offset,
    rows: rows.slice(params.offset, params.offset + params.limit),
  };
}
