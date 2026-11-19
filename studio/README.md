# OmniPix Studio — coding-agent workspace UI (mock prototype)

React + Vite + TypeScript + Tailwind v4, dark-first. Every screen runs on
mock data shaped like the real OmniPix API, so the full workspace is
clickable with no backend.

```bash
cd studio
npm install
npm run dev      # http://localhost:5174/
```

Deep links: `#/chat`, `#/agents`, `#/skills`, `#/keys`, `#/evals`,
`#/search`, `#/docs`, `#/voice`, `#/notifications`.

Coverage: workspace switcher + file tree + context chips, Ask/Plan/Agent
modes, plan card, live step timeline, thinking blocks, approvals
(allow once / always / deny), checkpoints, split+unified diffs with
per-file/per-hunk accept, terminals, preview, logs, git actions,
command palette, settings modal, providers, evals + usage, docs +
memories, voice, notifications, onboarding, offline/error/empty states.
