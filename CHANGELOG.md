# OmniPix changelog

## 0.2.0

Agent superpowers + distribution readiness.

### New agent tools
- Browser automation: `browser_navigate`, `browser_snapshot`, `browser_click`,
  `browser_type`, `browser_screenshot` — a managed headless Chrome driven over
  CDP. Public and localhost URLs allowed; private ranges refused.
- Office documents: `read_office` (Word/Excel/PowerPoint/OpenDocument as text),
  `write_docx`, `write_xlsx`, `write_pptx` — agents read and author real
  `.docx`/`.xlsx`/`.pptx` files inside the run workspace.

### Search
- New Search web tab with keyless live search (proven against real queries).
- Provider search fan-out with tiered catalog; no seeded engines.

### Chat + workspace
- PDF upload parsing: dropped PDFs extract to text inline in chat.
- `@file` finder: fuzzy workspace file attach from the mention menu.
- File-first skills, markdown agents/commands, CLI `--agent`, install.sh flow.

### Quality
- Full suites green: server, CLI, client, studio, e2e.
- UI audit batches B1–B6: every surface probed, dead controls fixed.
- Attribution audit: homage comments neutralized; license notices kept.
