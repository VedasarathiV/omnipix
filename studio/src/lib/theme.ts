// Theme preference: persisted choice (dark/light/system) with a boot-time
// applier. The same key is read by the inline script in index.html so the
// first paint already matches; React re-applies on change and tracks the
// OS setting while 'system' is active.

export type ThemePref = 'dark' | 'light' | 'system';

const THEME_KEY = 'studio.theme';

export function loadThemePref(): ThemePref {
  try {
    const raw = window.localStorage.getItem(THEME_KEY);
    if (raw === 'dark' || raw === 'light' || raw === 'system') return raw;
  } catch {
    // Private mode: fall through to the default.
  }
  return 'dark';
}

/** Pure resolver so the unit suite can pin the matrix. */
export function resolveDark(pref: ThemePref, systemDark: boolean): boolean {
  return pref === 'dark' || (pref === 'system' && systemDark);
}

let systemQuery: MediaQueryList | null = null;
let systemHandler: (() => void) | null = null;

function stopTracking(): void {
  if (systemQuery && systemHandler) {
    if (typeof systemQuery.removeEventListener === 'function') systemQuery.removeEventListener('change', systemHandler);
    else systemQuery.removeListener(systemHandler);
  }
  systemQuery = null;
  systemHandler = null;
}

export function applyTheme(pref: ThemePref): void {
  try {
    window.localStorage.setItem(THEME_KEY, pref);
  } catch {
    // Private mode: preference just doesn't persist.
  }
  stopTracking();
  const root = document.documentElement;
  if (pref === 'system' && typeof window.matchMedia === 'function') {
    const query = window.matchMedia('(prefers-color-scheme: light)');
    systemQuery = query;
    systemHandler = () => root.classList.toggle('dark', !query.matches);
    if (typeof query.addEventListener === 'function') query.addEventListener('change', systemHandler);
    else query.addListener(systemHandler);
    root.classList.toggle('dark', !query.matches);
    return;
  }
  root.classList.toggle('dark', pref !== 'light');
}
