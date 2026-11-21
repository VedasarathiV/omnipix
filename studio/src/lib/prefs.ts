// Shared UI preferences (local-first, localStorage-backed).

export type DiffView = 'split' | 'unified';

const DIFF_KEY = 'studio.diffView';

export function loadDiffView(): DiffView {
  try {
    return window.localStorage.getItem(DIFF_KEY) === 'unified' ? 'unified' : 'split';
  } catch {
    return 'split';
  }
}

export function saveDiffView(view: DiffView): void {
  try {
    window.localStorage.setItem(DIFF_KEY, view);
  } catch {
    // Private mode: preference just doesn't persist.
  }
}
