// Sizing rules for the artifact panel: how wide it may be, what it opens at,
// and where the chosen width is remembered. Pure, so the clamp and the
// storage round-trip are tested without a DOM.

export const ARTIFACT_WIDTH_STORAGE_KEY = 'playground.artifactWidth'
/** Narrower than this and the header actions collide with the tabs. */
export const ARTIFACT_MIN_WIDTH = 320
/** What the chat column must keep, so the panel can never push it away. */
export const CHAT_MIN_WIDTH = 360
/** Workbench chrome beside the page at md+: activity rail (52) + sidebar (208). */
export const WORKBENCH_CHROME_WIDTH = 52 + 208
/** Playground conversation rail: open (240) or collapsed to icons (44). */
export const CONVERSATION_RAIL_OPEN_WIDTH = 240
export const CONVERSATION_RAIL_COLLAPSED_WIDTH = 44
/** First open, before the user has dragged: the Artifacts-panel proportion. */
export const ARTIFACT_DEFAULT_FRACTION = 0.45
export const ARTIFACT_DEFAULT_MAX = 560
/** Keyboard resize step on the handle, px. */
export const ARTIFACT_KEY_STEP = 24

/**
 * Largest width the viewport allows while the chat keeps its minimum.
 * `chromeWidth` is everything else sharing the row (workbench rails,
 * conversation rail): without it the max assumes the pane sits next to a
 * full-viewport chat and overflows at md widths.
 */
export function maxArtifactWidth(viewportWidth: number, chromeWidth = 0): number {
  return Math.max(ARTIFACT_MIN_WIDTH, Math.floor(viewportWidth - CHAT_MIN_WIDTH - chromeWidth))
}

export function clampArtifactWidth(width: number, viewportWidth: number, chromeWidth = 0): number {
  if (!Number.isFinite(width)) return defaultArtifactWidth(viewportWidth, chromeWidth)
  return Math.round(Math.min(maxArtifactWidth(viewportWidth, chromeWidth), Math.max(ARTIFACT_MIN_WIDTH, width)))
}

export function defaultArtifactWidth(viewportWidth: number, chromeWidth = 0): number {
  return clampArtifactWidth(Math.min(ARTIFACT_DEFAULT_MAX, viewportWidth * ARTIFACT_DEFAULT_FRACTION), viewportWidth, chromeWidth)
}

/** The remembered width, or the default when nothing valid is stored. */
export function readArtifactWidth(stored: string | null | undefined, viewportWidth: number, chromeWidth = 0): number {
  const n = stored == null ? NaN : Number(stored)
  return Number.isFinite(n) && n > 0 ? clampArtifactWidth(n, viewportWidth, chromeWidth) : defaultArtifactWidth(viewportWidth, chromeWidth)
}

/** Width after a drag: the handle is on the LEFT edge, so moving the pointer
 *  left (negative dx) makes the panel wider. */
export function draggedArtifactWidth(startWidth: number, startX: number, clientX: number, viewportWidth: number, chromeWidth = 0): number {
  return clampArtifactWidth(startWidth + (startX - clientX), viewportWidth, chromeWidth)
}
