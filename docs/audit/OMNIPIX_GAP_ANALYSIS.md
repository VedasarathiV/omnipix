# OMNIPIX — Gap Analysis

Stable IDs. Priority: P0 critical · P1 high · P2 medium · P3 low.
Complexity: S/M/L. Each item: situation → problem → evidence → impacts →
fix → deps.

## 1. Critical missing functionality (P0)

- **GAP-SEC-01 (HIGH)** DNS-blind SSRF in fetch guard. Situation: literal-IP
  checks only [P0-read]. Problem: DNS names to metadata/internal hosts pass;
  agent `fetch_url` follows redirects through the same guard. Impact: cloud
  credential theft via prompt injection. Fix: DNS-resolving guard +
  redirect-to-private block + metadata denylist. Deps: none. Complexity M.
- **GAP-UI-01 (HIGH)** Onboarding exits at step 0; folder picker fake
  [P0-read]. Impact: first-run experience is broken; users never see the
  tour. Fix: advance steps; wire/remove picker. Complexity S.
- **GAP-UI-02 (HIGH)** Toast-only message/terminal/settings actions [P0-read].
  Impact: users believe copy/apply/branch/delete happened. Fix: implement
  clipboard/API or remove buttons. Complexity M.
- **GAP-UI-03 (HIGH)** Decorative chips/slash/@-mentions never sent. Impact:
  silently dropped context. Fix: include in payload + parse, or remove. M.
- **GAP-DOC-03 (HIGH)** Dual-frontend canonical choice undocumented; shipped
  UI differs by target. Impact: strategic confusion for users + contributors.
  Fix: declare canonical + align builds. S (doc) / L (unify).

## 2. Core product improvements (P1)

GAP-SEC-03 (unified key plaintext), GAP-SEC-04 (shell denylist/allow),
GAP-SEC-05 (MCP exec allowlist), GAP-SEC-06 (`::` default), GAP-API-01/02/03
(keys/:id, webhooks edit, embeddings POST), GAP-API-08 (pagination),
GAP-DB-01/02 (encrypt cache + unified key), GAP-UI-04 (desktop bridges),
GAP-UI-05 (mobile rails), GAP-UI-06 (timeline/diff/terminal correctness),
GAP-DOC-01/02 (stale READMEs), GAP-ARCH-01 (event-loop SQLite + buffering +
serial failover), GAP-TEST-01/02 (studio tests/e2e; Node ABI pin).

## 3. Architecture improvements (P2/L)

GAP-ARCH-02 (persist or document in-memory state), GAP-ARCH-03 (catalog
freshness guard; desktop-mirror contract exists — extend to schedulers),
GAP-DB-03 (FKs + document intentional exceptions).

## 4. Security improvements

Covered in §1–2 (SEC-01…06 P0/P1) plus: GAP-SEC-07 (persist lockouts, P2/M),
GAP-SEC-09 (codes out of logs, P2/S), GAP-SEC-02 TOCTOU pinning (P2/L),
GAP-SEC-08 password policy (P3/S), GAP-SEC-10 retention docs (P3/S).

## 5. Performance improvements

GAP-ARCH-01 (stream vision, cap hops, load smoke), GAP-API-08 (paginate),
GAP-API-10 (SSE redaction or documented limit), proxy analytics write
batching (new observation from hot-path review).

## 6. UX improvements

§1 UI items + GAP-UI-07 (shortcut truthfulness, P2/S), GAP-UI-08 (focus
traps/contrast/markdown, P2/M), GAP-UI-09 (real cwd, settings rail, P3/S).

## 7. Advanced capabilities (future)

Per-key inference quotas (GAP-API-09), retry-safe admin POSTs (GAP-API-07),
typed-error rollout + shape docs (GAP-API-05), MCP exec audit log (with
SEC-05), e2e + load + fuzz suites (GAP-TEST-01), multi-user/RBAC (out of
current single-user scope — product decision required).

## 8. Future opportunities

Canonical-UI declaration → unified builds; skill/runbook marketplace;
eval-driven model ops; team-gateway appliance; premium feed hosting
decision; Windows/Linux desktop parity; docs-tree consolidation
(GAP-DOC-04).

## 9. Explicit non-gaps (verified, do not "fix")

- `requests` not FK'd to models: intentional history preservation.
- `/v1/systemone` alias, `/api`+`/v1` dual surfaces: intentional compat.
- HSTS off, no cookies, open liveness/docs: documented local-first choices.
- Baseline migration irreversible; some downs data-destructive: by design.
- No in-flight idempotency dedup: documented design.
- `local/ollama` routes flagged "dead" by client-grep are consumed by
  Studio [P0] — disposition, don't delete.
