/** Fired to open the Updates dialog from anywhere (the ⋯ menu, the update pill). */
export const OPEN_UPDATES_EVENT = 'omnipix:open-updates'

export function openUpdates(): void {
  window.dispatchEvent(new Event(OPEN_UPDATES_EVENT))
}

/**
 * "Release notes" link for the Updates dialog. Empty unless the operator bakes
 * VITE_OMNIPIX_RELEASES_URL in at build time — standalone builds have no
 * releases page, and the dialog hides the link when this is empty.
 */
export const RELEASES_URL: string =
  (import.meta.env.VITE_OMNIPIX_RELEASES_URL as string | undefined) ?? ''
