// @vitest-environment jsdom
// Brand lockup: bigger animated mark in the header, static by default.
import { afterEach, beforeAll, beforeEach, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { I18nProvider } from '@/i18n'
import { Brand, BrandMark } from './brand'

let root: Root
let container: HTMLDivElement
const flush = async () => { for (let i = 0; i < 4; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)) }) }

beforeAll(() => {
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); container.remove() })

it('renders the header lockup with an animated mark', async () => {
  act(() => root.render(
    <MemoryRouter><I18nProvider><Brand /></I18nProvider></MemoryRouter>,
  ))
  await flush()
  expect(container.textContent).toContain('OmniPix')
  expect(container.querySelector('svg')?.getAttribute('width')).toBe('26')
  expect(container.querySelector('.ox-brand-arc')).not.toBeNull()
  expect(container.querySelector('.ox-brand-core')).not.toBeNull()
})

it('stays static without the animated flag', async () => {
  act(() => root.render(<BrandMark size={16} />))
  await flush()
  expect(container.querySelector('svg')?.getAttribute('width')).toBe('16')
  expect(container.querySelector('.ox-brand-arc')).toBeNull()
  expect(container.querySelector('.ox-brand-core')).toBeNull()
})
