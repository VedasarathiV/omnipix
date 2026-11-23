import { useEffect, useState } from 'react'

// The opened project folder, shared by the sidebar, the chat, and the Files
// panel. One writer model: whoever picks/closes a folder writes localStorage
// and broadcasts, so every surface agrees without prop drilling.

export interface OpenFolder {
  root: string
  tree: string
  files: number
  truncated: boolean
}

export const FOLDER_STORAGE_KEY = 'omnipix.openFolder'
export const RECENT_FOLDERS_KEY = 'omnipix.recentFolders'
export const MAX_RECENT_FOLDERS = 5
export const FOLDER_CHANGED_EVENT = 'omnipix:folder-changed'
/** Detail: { tab: 'logs' | 'health' | 'terminal' | 'files' }. Opens the panel. */
export const OPEN_PANEL_EVENT = 'omnipix:open-panel'

function readStored(): OpenFolder | null {
  try {
    const raw = localStorage.getItem(FOLDER_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<OpenFolder>
    if (typeof parsed.root !== 'string' || typeof parsed.tree !== 'string') return null
    return {
      root: parsed.root,
      tree: parsed.tree,
      files: typeof parsed.files === 'number' ? parsed.files : 0,
      truncated: parsed.truncated === true,
    }
  } catch {
    return null
  }
}

export function setOpenFolder(folder: OpenFolder | null): void {
  try {
    if (folder) {
      localStorage.setItem(FOLDER_STORAGE_KEY, JSON.stringify(folder))
      pushRecentFolder(folder.root)
    } else {
      localStorage.removeItem(FOLDER_STORAGE_KEY)
    }
  } catch {
    // Private mode: state still works for this session.
  }
  window.dispatchEvent(new Event(FOLDER_CHANGED_EVENT))
}

/** Most-recently-opened project roots, newest first. Updated on every open. */
export function readRecentFolders(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_FOLDERS_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((r): r is string => typeof r === 'string') : []
  } catch {
    return []
  }
}

function pushRecentFolder(root: string): void {
  try {
    const next = [root, ...readRecentFolders().filter(r => r !== root)].slice(0, MAX_RECENT_FOLDERS)
    localStorage.setItem(RECENT_FOLDERS_KEY, JSON.stringify(next))
  } catch {
    // Private mode: recents simply don't persist.
  }
}

export function useOpenFolder(): [OpenFolder | null, (folder: OpenFolder | null) => void] {
  const [folder, setFolder] = useState<OpenFolder | null>(readStored)
  useEffect(() => {
    const sync = () => setFolder(readStored())
    window.addEventListener(FOLDER_CHANGED_EVENT, sync)
    return () => window.removeEventListener(FOLDER_CHANGED_EVENT, sync)
  }, [])
  return [folder, setOpenFolder]
}

/**
 * Folder context for every chat request while a folder is open. Written
 * bluntly for small local models: it names the exact path, forbids
 * path-asking, and forbids "I cannot see it" — the failure mode weak models
 * default to when the context arrives as a system message they skim past.
 */
export function folderContextMessage(folder: OpenFolder): string {
  return [
    `You CAN see the user's project folder. Its exact path is: ${folder.root} (${folder.files} files${folder.truncated ? ', tree truncated to the first entries' : ''}).`,
    'When the user says "this folder", "the folder", or names it, answer FROM the tree below: file names, layout, and paths are facts. Never ask for the folder path. Never say you cannot see it.',
    '```',
    folder.tree,
    '```',
  ].join('\n')
}

export interface ChatTurn {
  role: string
  content: unknown
}

/**
 * Pin the folder context into the request as a user message immediately
 * before the final user turn — recency beats preamble for small models.
 * Falls back to appending when the transcript does not end with the user.
 */
export function pinFolderContext<T extends ChatTurn>(turns: T[], folder: OpenFolder): (T | ChatTurn)[] {
  const context: ChatTurn = { role: 'user', content: folderContextMessage(folder) }
  const last = turns[turns.length - 1]
  if (!last || last.role !== 'user') return [...turns, context]
  return [...turns.slice(0, -1), context, last]
}
