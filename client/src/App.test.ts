import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// The shell pins to the viewport on every route: sidebar, header, and
// activity bar stay fixed while only the content pane scrolls. Letting the
// document scroll instead drags the whole chrome along with the page. The
// contract lives in a couple of class strings in App.tsx and the workbench
// and regresses silently, so it is pinned here like the chain manager pins
// its routing.
const here = path.dirname(fileURLToPath(import.meta.url))
const app = readFileSync(path.join(here, 'App.tsx'), 'utf8')
const workbench = readFileSync(path.join(here, 'components/workbench/workbench.tsx'), 'utf8')
const playground = readFileSync(path.join(here, 'pages/PlaygroundPage.tsx'), 'utf8')

describe('app shell heights', () => {
  it('pins the shell to the viewport on every route', () => {
    // h-dvh gives the shell a definite height; overflow-hidden stops the
    // document itself from scrolling on any route, padded or full-bleed.
    expect(app).toContain('flex h-dvh flex-col overflow-hidden')
    expect(app).not.toContain('min-h-screen')
  })

  it('scrolls padded pages inside their own pane', () => {
    // Without an inner scroll container, pinning the shell would leave long
    // pages with no scrollbar at all.
    expect(app).toContain('min-h-0 flex-1 overflow-y-auto')
  })

  it('renders page content on mobile instead of hiding it', () => {
    // The old `hidden md:flex` workbench row swallowed the page below md.
    expect(workbench).not.toContain('hidden min-h-0 flex-1 md:flex')
  })

  it('passes a definite height down the flex chain to the page', () => {
    // Dropping min-h-0/flex-1 anywhere between the shell and the page lets
    // the content size its ancestors again, which is the original bug by
    // another route.
    expect(app).toContain("'flex min-h-0 flex-1 flex-col'")
    expect(playground).toContain('flex min-h-0 flex-1 overflow-hidden')
  })

  it('keeps /playground in the full-bleed set', () => {
    expect(app).toMatch(/FULL_BLEED_ROUTES = new Set\(\[[^\]]*'\/playground'[^\]]*\]\)/)
  })
})
