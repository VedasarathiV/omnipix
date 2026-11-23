// @vitest-environment jsdom
// Code pane: the chat's second column. Files as chips, active file
// highlighted, resizable edge, close.
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { I18nProvider } from '@/i18n'
import { CodePane } from './code-pane'
import type { CodeFile } from '@/lib/artifacts'

const FILES: CodeFile[] = [
  { id: 'code:0:1', language: 'js', code: 'console.log(1)', filename: 'snippet-1.js' },
  { id: 'code:0:2', language: 'python', code: 'print(2)', filename: 'snippet-2.py' },
]

let root: Root
let container: HTMLDivElement
beforeAll(() => { (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true })
beforeEach(() => {
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); container.remove() })

function mount(overrides: Partial<Parameters<typeof CodePane>[0]> = {}, onSelect = vi.fn(), onClose = vi.fn(), onWidthChange = vi.fn(), onWidthCommit = vi.fn()) {
  const props = {
    files: FILES, activeId: null, onSelect, open: true, width: 400,
    onWidthChange, onWidthCommit, onClose, ...overrides,
  }
  act(() => root.render(
    <I18nProvider initialLocale="en"><CodePane {...props} /></I18nProvider>,
  ))
  return { onSelect, onClose, onWidthChange, onWidthCommit }
}

it('shows the latest file with a chip per file', () => {
  mount()
  expect(container.textContent).toContain('snippet-1.js')
  expect(container.textContent).toContain('snippet-2.py')
  expect(container.textContent).toContain('print(2)')
  const tabs = [...container.querySelectorAll('[role="tab"]')]
  expect(tabs).toHaveLength(2)
  expect(tabs[1].getAttribute('aria-selected')).toBe('true')
})

it('switches files when a chip is clicked', () => {
  const { onSelect } = mount()
  const tabs = [...container.querySelectorAll('[role="tab"]')]
  act(() => { tabs[0].dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  expect(onSelect).toHaveBeenCalledWith('code:0:1')
})

it('honours an explicit active id', () => {
  mount({ activeId: 'code:0:1' })
  expect(container.textContent).toContain('console.log(1)')
})

it('closes via the close button', () => {
  const { onClose } = mount()
  const close = container.querySelector('[aria-label="Close code pane"]')!
  act(() => { close.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  expect(onClose).toHaveBeenCalledTimes(1)
})

it('resizes from the keyboard: ArrowLeft grows the pane', () => {
  const { onWidthChange } = mount()
  const handle = container.querySelector('[role="separator"]')!
  expect(handle.getAttribute('aria-valuemin')).toBe('320')
  expect(handle.getAttribute('aria-valuemax')).toBe('664')
  act(() => { handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })) })
  expect(onWidthChange).toHaveBeenCalledWith(424)
})

it('ArrowRight shrinks and clamps at the minimum', () => {
  const { onWidthChange } = mount()
  const handle = container.querySelector('[role="separator"]')!
  act(() => { handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })) })
  expect(onWidthChange).toHaveBeenCalledWith(376)
  const { onWidthChange: small } = mount({ width: 320 })
  const smallHandle = container.querySelector('[role="separator"]')!
  act(() => { smallHandle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })) })
  expect(small).toHaveBeenCalledWith(320)
})

it('drags the edge and commits the event-derived width on release', () => {
  const { onWidthChange, onWidthCommit } = mount()
  const handle = container.querySelector('[role="separator"]') as HTMLElement
  const down = new PointerEvent('pointerdown', { bubbles: true, clientX: 500 })
  act(() => { handle.dispatchEvent(down) })
  act(() => { handle.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 450 })) })
  expect(onWidthChange).toHaveBeenLastCalledWith(450)
  act(() => { handle.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 430 })) })
  // Committed from the up event (470), not the last rendered width (450).
  expect(onWidthCommit).toHaveBeenCalledWith(470)
  expect(onWidthChange).toHaveBeenLastCalledWith(470)
})

it('hides content accessibly while closed', () => {
  mount({ open: false })
  const pane = container.querySelector('[data-testid="code-pane"]')!
  expect(pane.getAttribute('data-open')).toBe('false')
  expect(pane.getAttribute('aria-hidden')).toBe('true')
  expect(pane.hasAttribute('inert')).toBe(true)
})
