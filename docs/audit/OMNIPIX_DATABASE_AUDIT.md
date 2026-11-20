# OMNIPIX — Database Audit

Engine: better-sqlite3 sync connection (`connectDb`), WAL + `foreign_keys=ON`
+ `busy_timeout=5000` on file DBs; node:sqlite adapter (SAVEPOINT nesting)
on Android path; `Db/DbStatement` contract [R: db/index.ts:32-47,81-89;
db/node-sqlite.ts:79-111; db/types.ts:1-27].

## 1. Schema map (by migration)

**Baseline** (`20260101_000000_legacy_baseline.ts`, L99-266 + extensions):
`models` (UNIQUE platform,model_id; paid $/M via boot pricing), `api_keys`
(AES triplets, status), `requests`, `rate_limit_usage` (CHECK kind),
`rate_limit_cooldowns` (composite PK), `fallback_config` (FK→models, UNIQUE,
**no ON DELETE**), `profiles`, `profile_models` (CASCADE ×2),
`settings` (PK key), `users` (UNIQUE email), `sessions` (token_hash PK,
CASCADE), `provider_quota_state/observations`, `embedding_models`,
`media_models`, `quirks` + `quirk_targets` (CASCADE) [R].

**Routing/analytics**: `request_attempts` (CASCADE), `request_hourly` (hour
PK), `key_monthly_usage` + `model_monthly_usage` (AFTER INSERT triggers),
`cloudflare_neuron_usage` [R].

**Identity/config**: `client_profiles`, `url_tokens` (UNIQUE token_hash),
`catalog_model_tombstones` + `model_overrides`, `custom_model_tombstones`,
`model_probe_status` [R].

**Logs/cache**: `server_logs` (CHECK level, created_at index),
`search_requests`, `decision_requests` (CHECK + 2 idx each),
`idempotency_claims` (UNIQUE key_hash, expiry idx), `response_cache`
(key PK, expiry idx, semantic cols), `playground_conversations`, `backups`,
`migrations` ledger [R].

**Agents** (`20261118_*`): `agent_runs` (+session/project/plan/parent/
auto_approve), `agent_steps` (CASCADE), `agent_memory`, `skills` (PK name),
`agent_sessions`, `approvals` (+2 idx), `agent_groups` (+mode/manager),
`agent_tasks` (contract/guardrail/output cols), `blackboard`,
`file_locks`, `mcp_servers` (UNIQUE name, AES triplets), `eval_suites/runs`,
`memories`, `automations` (+`watch_json`), `notifications`, `checkpoints`,
`agent_hooks`, `security_scans/findings`, `doc_chunks`, `learning_proposals`
+ `runs_fts` (FTS5 + 3 triggers), `approval_rules` (CHECK allow/deny),
`webhooks` (AES secret), `debates` [R].

**Evolved columns** (ALTERs): requests += ttfb/requested_model/key/client/
served_model/caller/model_db_id/attribution/media_db_id; api_keys +=
base_url/proxy creds/scope/caps/group/health/verification; models +=
tools/source/endpoint_scope; profiles += auto-include/strategy [R].

## 2. Migration strategy

Static `DEFAULT_MIGRATIONS` registry (~80, up+down each); runner wraps every
up/down + ledger write in a transaction; prod auto-runs on boot, dev manual;
CLI create/up/down/fresh/status; fresh blocked in prod; down reverts only
latest [R]. Pricing runs every boot (not a migration); baseline seeds V1–V25
then frozen (data via signed catalog); quirks reset-and-insert; endpoint
rebuilds preserve-then-rename [R]. Baseline irreversible by design; some
downs refuse on duplicates or stash rows for reversibility; table-drop downs
are schema-reversible but data-destructive [R].

## 3. Query safety & patterns

- **SQLi**: 768 `.prepare` sites audited — values parameterized; ORDER BY
  from whitelists; table/column interpolation from const lists; savepoint
  names are internal counters. **No user-controlled identifier reaches SQL**
  [R].
- **N+1**: hot paths batched (`logRequest` INSERT+upsert+settings in one tx;
  attempts single prepared INSERT; catalog apply one tx; key delete+rebind
  one tx). Boot-only per-row loops only [R].
- **Tx gaps**: auth check-then-write races (UNIQUE backstop turns them into
  constraint errors, not silent dupes) — GAP-DB-04 [R].

## 4. Integrity gaps

Missing FKs (orphan-capable): `requests.key_id/model_db_id/media_model_db_id`,
`agent_tasks.writer_task_id`, `file_locks.task_id`,
`learning_proposals.source_run_id`, `key_monthly_usage.key_id`;
`fallback_config` lacks ON DELETE (app-ordered deletes). `requests`→models
absence is **intentional** (history survives provider removal) [R]
(GAP-DB-03).

## 5. Backups & retention

SQL-dump writer (quote-doubling, blob/non-finite handling), 0600 files,
dir-confined with symlink check; excludes users/sessions/tokens, ledger,
FTS; restore enforces format/schema/key-fingerprint, pre-restore snapshot,
single tx [R]. Retention: requests 90d/100k, logs 7d/50k, quota obs chunked,
search/decision 90d/100k, expiry sweeps, 60s+daily gates; monthly/hourly
ledgers prune-safe [R].

## 6. Secrets & access

AES-256-GCM triplets for keys/proxies/profiles/MCP env/headers/webhook
secrets; key precedence env > file > legacy > dev-generate; prod requires
env; 16B tag anti-truncation; boot decrypt probe; dump fingerprint [R].
**Gaps**: `response_cache` plaintext on disk (master switch, off default);
unified key + settings plaintext; no whole-DB encryption (0600 reliance) —
GAP-DB-01/02 [R].
