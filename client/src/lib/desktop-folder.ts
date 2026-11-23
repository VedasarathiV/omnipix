// Desktop folder bridge: the Playground's + menu offers "Folder" only inside
// the desktop shell, where the preload exposes the native picker and reader.
// Both calls resolve through `omnipix:pick-folder` / `omnipix:read-folder`
// in desktop/src/main.ts; in a browser the bridge is absent and the caller
// hides the option.

export interface FolderTreeResult {
  root: string;
  tree: string;
  files: number;
  truncated: boolean;
}

interface FolderBridge {
  __OMNIPIX_PICK_FOLDER__?: () => Promise<string | null>;
  __OMNIPIX_READ_FOLDER__?: (dir: string) => Promise<FolderTreeResult>;
}

function bridge(): FolderBridge | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as FolderBridge;
  return typeof w.__OMNIPIX_PICK_FOLDER__ === 'function' &&
    typeof w.__OMNIPIX_READ_FOLDER__ === 'function'
    ? w
    : null;
}

/** True inside the desktop shell, where picking a folder is possible. */
export function canPickFolder(): boolean {
  return bridge() !== null;
}

/**
 * Open the native picker and read the chosen folder into a capped text tree.
 * Resolves null when the user cancels. Throws when the shell is absent or
 * the read fails — the caller toasts.
 */
export async function pickFolderTree(): Promise<FolderTreeResult | null> {
  const b = bridge();
  if (!b) throw new Error('Folder picker is only available in the desktop app');
  const dir = await b.__OMNIPIX_PICK_FOLDER__!();
  if (!dir) return null;
  return b.__OMNIPIX_READ_FOLDER__!(dir);
}

/**
 * Re-read a KNOWN folder without the picker (chat restore, recent folders).
 * Throws when the shell is absent or the read fails — callers fall back to
 * the stored snapshot or toast.
 */
export async function readFolderTree(dir: string): Promise<FolderTreeResult> {
  const b = bridge();
  if (!b) throw new Error('Folder reading is only available in the desktop app');
  return b.__OMNIPIX_READ_FOLDER__!(dir);
}
