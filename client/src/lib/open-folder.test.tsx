// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { folderContextMessage, pinFolderContext, readRecentFolders, setOpenFolder, useOpenFolder, FOLDER_CHANGED_EVENT, MAX_RECENT_FOLDERS } from './open-folder'
import { act } from 'react'
import { createRoot } from 'react-dom/client'

const TREE = { root: '/proj', tree: 'proj/\n└── a.ts', files: 1, truncated: false }

describe('open folder state', () => {
  it('builds a context message that forbids path-asking', () => {
    const msg = folderContextMessage(TREE)
    expect(msg).toContain('/proj')
    expect(msg).toContain('Never ask for the folder path')
    expect(msg).toContain('Never say you cannot see it')
    expect(msg).toContain('a.ts')
  })

  it('syncs across hook instances through storage + event', async () => {
    localStorage.clear()
    let seenA: unknown = 'unset'
    let seenB: unknown = 'unset'
    function Probe({ report }: { report: (v: unknown) => void }) {
      const [folder] = useOpenFolder()
      report(folder)
      return null
    }
    const c1 = document.createElement('div')
    const c2 = document.createElement('div')
    document.body.append(c1, c2)
    const r1 = createRoot(c1)
    const r2 = createRoot(c2)
    await act(async () => {
      r1.render(<Probe report={v => { seenA = v }} />)
      r2.render(<Probe report={v => { seenB = v }} />)
    })
    expect(seenA).toBeNull()
    await act(async () => { setOpenFolder(TREE) })
    expect((seenA as typeof TREE).root).toBe('/proj')
    expect((seenB as typeof TREE).root).toBe('/proj')
    await act(async () => { setOpenFolder(null) })
    expect(seenA).toBeNull()
    expect(seenB).toBeNull()
    expect(new CustomEvent(FOLDER_CHANGED_EVENT)).toBeTruthy()
    r1.unmount()
    r2.unmount()
    c1.remove()
    c2.remove()
    localStorage.clear()
  })

  it('tracks recent folders newest-first, deduped and capped', () => {
    localStorage.clear()
    expect(readRecentFolders()).toEqual([])
    setOpenFolder({ ...TREE, root: '/a' })
    setOpenFolder({ ...TREE, root: '/b' })
    setOpenFolder({ ...TREE, root: '/a' })
    expect(readRecentFolders()).toEqual(['/a', '/b'])
    for (let i = 0; i < MAX_RECENT_FOLDERS + 3; i++) {
      setOpenFolder({ ...TREE, root: `/r${i}` })
    }
    const recent = readRecentFolders()
    expect(recent).toHaveLength(MAX_RECENT_FOLDERS)
    expect(recent[0]).toBe(`/r${MAX_RECENT_FOLDERS + 2}`)
    // Closing a folder never erases the recents.
    setOpenFolder(null)
    expect(readRecentFolders()).toHaveLength(MAX_RECENT_FOLDERS)
    localStorage.clear()
  })

  it('ignores corrupt recents', () => {
    localStorage.clear()
    localStorage.setItem('omnipix.recentFolders', 'nope{')
    expect(readRecentFolders()).toEqual([])
    localStorage.clear()
  })

  it('pins folder context as a user turn before the final question', () => {
    const turns = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
      { role: 'user', content: 'inspect this folder' },
    ]
    const pinned = pinFolderContext(turns, TREE)
    expect(pinned.map(t => t.role)).toEqual(['user', 'assistant', 'user', 'user'])
    expect(String(pinned[2].content)).toContain('/proj')
    expect(String(pinned[2].content)).toContain('Never say you cannot see it')
    expect(pinned[3]).toEqual(turns[2])
  })

  it('appends the context when the transcript does not end with the user', () => {
    const turns = [{ role: 'assistant', content: 'hello' }]
    const pinned = pinFolderContext(turns, TREE)
    expect(pinned.map(t => t.role)).toEqual(['assistant', 'user'])
    expect(pinned).toHaveLength(2)
  })
})
