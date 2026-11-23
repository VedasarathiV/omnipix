// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { canPickFolder, pickFolderTree, readFolderTree } from './desktop-folder'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('desktop-folder bridge', () => {
  it('is absent in a plain browser', () => {
    expect(canPickFolder()).toBe(false)
    return expect(pickFolderTree()).rejects.toThrow('desktop app')
  })

  it('picks and reads through the preloaded bridge', async () => {
    const tree = { root: '/proj', tree: 'proj/\n└── a.ts', files: 1, truncated: false }
    vi.stubGlobal('__OMNIPIX_PICK_FOLDER__', vi.fn().mockResolvedValue('/proj'))
    vi.stubGlobal('__OMNIPIX_READ_FOLDER__', vi.fn().mockResolvedValue(tree))
    expect(canPickFolder()).toBe(true)
    await expect(pickFolderTree()).resolves.toEqual(tree)
  })

  it('resolves null when the user cancels', async () => {
    vi.stubGlobal('__OMNIPIX_PICK_FOLDER__', vi.fn().mockResolvedValue(null))
    vi.stubGlobal('__OMNIPIX_READ_FOLDER__', vi.fn())
    await expect(pickFolderTree()).resolves.toBeNull()
  })

  it('re-reads a known folder without the picker', async () => {
    const tree = { root: '/proj', tree: 'proj/', files: 0, truncated: false }
    const read = vi.fn().mockResolvedValue(tree)
    vi.stubGlobal('__OMNIPIX_PICK_FOLDER__', vi.fn())
    vi.stubGlobal('__OMNIPIX_READ_FOLDER__', read)
    await expect(readFolderTree('/proj')).resolves.toEqual(tree)
    expect(read).toHaveBeenCalledWith('/proj')
  })

  it('re-read throws without the bridge', async () => {
    await expect(readFolderTree('/proj')).rejects.toThrow('desktop app')
  })
})
