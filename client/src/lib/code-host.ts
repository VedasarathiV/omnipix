import { createContext } from 'react'

// A host that shows a code pane (the Playground) provides this; a fenced
// block that is not a runnable artifact then grows an "open in pane" button
// next to its copy button. Without a host, blocks render plain everywhere
// else Markdown is used.
export interface CodeHost {
  open: (language: string, code: string) => void
  /** The file currently open in the host, by its code, to mark it active. */
  activeCode?: string | null
}
export const CodeHostContext = createContext<CodeHost | null>(null)
