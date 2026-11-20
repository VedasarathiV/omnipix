# OMNIPIX — Security Audit

No credentials are reproduced here. No certification or production-readiness
is claimed. All findings cite inspected code [R]; the HIGH item's guard file
was additionally read by the parent [P0].

## Findings by severity

### HIGH

- **GAP-SEC-01 — DNS-blind SSRF in fetch guard.** `lib/fetch-guard.ts:6-28`
  (`isBlockedFetchUrl`) checks literal hostnames/IPs only and never resolves
  DNS [P0: read]. Consumed by agent `fetch_url` (`services/agent-tools.ts:
  109-135`, `redirect:'follow'`, recheck is the same literal guard) and docs
  ingest (`services/docs-ingest.ts:150-163`). A prompt-injected agent or
  pasted doc URL can reach cloud metadata / internal hosts via DNS names.
  Fix: resolve+classify DNS like `url-guard`, block redirect-to-private,
  deny metadata hosts. Priority P0.

### MEDIUM

- **GAP-SEC-02 — SSRF TOCTOU.** Hostname resolved at assess time, re-resolved
  at use (`lib/url-guard.ts:31-36`); narrowed by request-time assert
  (`lib/proxy.ts:839-840`) + redirect refusal + save-time rejection
  (`routes/keys.ts:1083-1088`). Residual deliberate-rebinding window.
- **GAP-SEC-03 — Unified API key plaintext at rest** (`db/index.ts:250-257`).
  DB copy compromises `/v1`+Gemini+Ollama+MCP. Mitigated by timing-safe
  compare + URL-token refusal of raw keys. Fix: hash-or-encrypt + rotation.
- **GAP-SEC-04 — Shell denylist bypassable** (self-declared backstop,
  `lib/workspace.ts:109-120` misses `rm -rf ~`, `$HOME`, `find / -delete`,
  spacing variants) **+ persistent allow rules can silence the approval
  tier** (`lib/agent-policy.ts:102-132`). Real containment: approval + cwd
  lock + env scrub + caps + opt-in docker.
- **GAP-SEC-05 — MCP registry arbitrary local exec**, no command allowlist
  (`services/mcp-servers.ts:139-145,222,344`). Dashboard-gated single-user
  by design, but XSS/session-theft or exposed LAN dashboard = RCE as the
  server user. Agent-side MCP tools correctly parked as shell tier.
- **GAP-SEC-06 — Default `::` listen + opt-in Host guard** (`lib/config.ts:
  82-85`; `middleware/allowed-hosts.ts:48-65` off when empty). Fresh installs
  are LAN-reachable with only in-memory limits; saved by setup-code gate +
  loopback check. Fix: loopback default or guard on.

### LOW

- **GAP-SEC-07** — Lockouts/limiters in-memory, restart-cleared; 10s global
  forgot-password throttle lets remote callers churn operator reset codes.
- **GAP-SEC-08** — Password min-8 only (hashing/sessions themselves strong:
  scrypt + 256-bit sessions hashed at rest, 30d TTL).
- **GAP-SEC-09** — Setup/reset codes + account email logged into the
  queryable server-log buffer (`/api/logs` readable by session holders).
- **GAP-SEC-10** — PII retention (IP/UA/agent class; prompts never logged,
  opt-out exists) + no tenant isolation (by single-user design).

## Verified strengths

- Ed25519 catalog verify-before-apply, pinned pubkey, missing-signature
  reject, no-phone-home default [R][P0: bundled snapshot path tested].
- AES-256-GCM key store (16B tag pin, 0600 atomic keyfile, prod-requires-env,
  offline rotation, boot decrypt probe) [R].
- Outbound webhooks HMAC-signed, secrets encrypted; no inbound webhooks [R].
- Helmet CSP + hashed bootstrap, CORS allowlist, no cookies (low CSRF),
  transcription auth-before-parse + multer caps, check-only updater [R].
- 768 SQL call sites: values parameterized, identifiers whitelisted [R].
- Deps: express^5.1/helmet^8/zod^4/undici^6/multer^2; sharp noted for native
  CVE history; `npm audit` not run (read-only audit) [R].

## Exposure notes

- CORS/CSRF posture is good (Bearer headers, no cookies); HSTS off is a
  documented local-HTTP choice [R].
- `GET /api/ping`, `/livez`, `/readyz`, `/v1/docs` intentionally open [R].
- Secrets in logs are broadly redacted (sk-/Bearer/JWT/32+ alnum) except
  GAP-SEC-09 [R].
