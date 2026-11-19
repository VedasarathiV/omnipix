// @vitest-environment jsdom
// Mention picker: lists filtered docs with project/chunk meta, marks the
// keyboard cursor, and reports doc vs. attach-file selection.
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { I18nProvider } from '@/i18n'
import { MentionPicker } from './mention-picker'

let root: Root
let container: HTMLDivElement
const flush = async () => { for (let i = 0; i < 4; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)) }) }

const DOCS = [
  { project_key: 'acme', source_url: 'https://x.test/guide', title: 'Widget Guide', chunks: 12, updated_at: '' },
  { project_key: 'acme', source_url: 'https://x.test/api', title: 'API Reference', chunks: 40, updated_at: '' },
]

beforeAll(() => {
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); container.remove() })

function render(props: Partial<React.ComponentProps<typeof MentionPicker>> = {}) {
  root.render(
    <I18nProvider>
      <MentionPicker
        docs={DOCS}
        activeIndex={0}
        onSelectDoc={() => {}}
        onAttachFile={() => {}}
        onHover={() => {}}
        {...props}
      />
    </I18nProvider>,
  )
}

it('lists docs and marks the cursor', async () => {
  const onHover = vi.fn()
  render({ activeIndex: 1, onHover })
  await flush()
  expect(container.textContent).toContain('Widget Guide')
  expect(container.textContent).toContain('acme')
  expect(container.textContent).toContain('40 chunks')
  expect(container.textContent).toContain('Attach a file…')
  const options = Array.from(container.querySelectorAll('[role="option"]'))
  expect(options).toHaveLength(3)
  expect(options[1].getAttribute('aria-selected')).toBe('true')
  expect(options[0].getAttribute('aria-selected')).toBe('false')
  await act(async () => { options[0].dispatchEvent(new MouseEvent('mouseover', { bubbles: true })) })
  expect(onHover).toHaveBeenCalledWith(0)
})

it('reports doc and attach-file clicks', async () => {
  const onSelectDoc = vi.fn()
  const onAttachFile = vi.fn()
  render({ onSelectDoc, onAttachFile })
  await flush()
  const options = Array.from(container.querySelectorAll('[role="option"]')) as HTMLButtonElement[]
  await act(async () => { options[0].dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  expect(onSelectDoc).toHaveBeenCalledWith(DOCS[0])
  await act(async () => { options[2].dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  expect(onAttachFile).toHaveBeenCalled()
})

it('shows the empty hint without docs', async () => {
  render({ docs: [] })
  await flush()
  expect(container.textContent).toContain('No ingested docs match')
})
