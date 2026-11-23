// System-wide push-to-talk hotkey for dictation. The register function is
// injected so the fallback chain is unit-testable without Electron.

export const DICTATION_ACCELERATORS = [
  'CommandOrControl+Shift+Space',
  'CommandOrControl+Shift+D',
  'CommandOrControl+Alt+D',
] as const;

/**
 * Register the first available dictation accelerator. Returns the one that
 * stuck, or null when every candidate is taken (the in-app mic buttons keep
 * working — only the global hotkey is lost).
 */
export function registerDictationHotkey(
  register: (accelerator: string, callback: () => void) => boolean,
  onToggle: () => void,
): string | null {
  for (const accelerator of DICTATION_ACCELERATORS) {
    try {
      if (register(accelerator, onToggle)) return accelerator;
    } catch {
      // Taken or invalid on this platform: try the next candidate.
    }
  }
  return null;
}

/** Render an accelerator the way the platform does (⌘⇧Space on mac). */
export function formatAccelerator(accelerator: string, platform: NodeJS.Platform = process.platform): string {
  if (platform === 'darwin') {
    return accelerator
      .replaceAll('CommandOrControl', '⌘')
      .replaceAll('Shift', '⇧')
      .replaceAll('Alt', '⌥')
      .replaceAll('Control', '⌃')
      .replaceAll('+', '');
  }
  return accelerator.replaceAll('CommandOrControl', 'Ctrl');
}
