import type { Db } from '../types.js';
import * as legacyBaseline from '../migrations/20260101_000000_legacy_baseline.js';
import * as customProviderModalities from '../migrations/20260627_000001_custom_provider_modalities.js';
import * as catalogModelState from '../migrations/20260627_000002_catalog_model_state.js';
import * as requestAggregates from '../migrations/20260628_120000_request_aggregates.js';
import * as githubGpt41Context from '../migrations/20260630_000001_github_gpt41_context.js';
import * as requestClientInfo from '../migrations/20260706_000001_request_client_info.js';
import * as customModelToolSupport from '../migrations/20260706_000002_custom_model_tool_support.js';
import * as profileChainBackfill from '../migrations/20260714_000001_profile_chain_backfill.js';
import * as keyHealthError from '../migrations/20260720_000001_key_health_error.js';
import * as cooldownProbeProvenance from '../migrations/20260726_000001_cooldown_probe_provenance.js';
import * as requestAttempts from '../migrations/20260726_000002_request_attempts.js';
import * as modelSourceProvenance from '../migrations/20260726_000003_model_source_provenance.js';
import * as mediaModelMeta from '../migrations/20260726_000004_media_model_meta.js';
import * as requestServedModel from '../migrations/20260726_000005_request_served_model.js';
import * as attemptErrorSummary from '../migrations/20260726_000006_attempt_error_summary.js';
import * as agentCompatibility from '../migrations/20260727_000001_agent_compatibility.js';
import * as tombstoneProvenance from '../migrations/20260728_000001_tombstone_provenance.js';
import * as customModelEndpointIdentity from '../migrations/20260729_000001_custom_model_endpoint_identity.js';
import * as customEndpointHostLabels from '../migrations/20260802_000001_custom_endpoint_host_labels.js';
import * as keyModelScope from '../migrations/20260805_000001_key_model_scope.js';
import * as clientProfiles from '../migrations/20260805_000002_client_profiles.js';
import * as apiKeyProxy from '../migrations/20260810_000001_api_key_proxy.js';
import * as playgroundConversations from '../migrations/20260820_000001_playground_conversations.js';
import * as customModelTombstones from '../migrations/20260819_000001_custom_model_tombstones.js';
import * as serverLogs from '../migrations/20260823_000001_server_logs.js';
import * as backupsTable from '../migrations/20260823_000002_backups_table.js';
import * as attemptKeyLabel from '../migrations/20260823_000003_attempt_key_label.js';
import * as profileAutoInclude from '../migrations/20260823_000004_profile_auto_include.js';
import * as idempotencyClaims from '../migrations/20260901_000001_idempotency_claims.js';
import * as requestCaller from '../migrations/20260901_000003_request_caller.js';
import * as quotaObservationLookup from '../migrations/20260901_000002_quota_observation_lookup.js';
import * as analyticsLatencyPercentileIndex from '../migrations/20260902_000001_analytics_latency_percentile_index.js';
import * as mcpEnabledDefault from '../migrations/20260903_000001_mcp_enabled_default.js';
import * as responseCache from '../migrations/20260903_000002_response_cache.js';
import * as keyMonthlyBudget from '../migrations/20260904_000001_key_monthly_budget.js';
import * as keyMonthlyUsage from '../migrations/20260914_000001_key_monthly_usage.js';
import * as quotaSnapshotFreshness from '../migrations/20260915_000001_quota_snapshot_freshness.js';
import * as requestModelAttribution from '../migrations/20260913_000001_request_model_attribution.js';
import * as customEndpointGroupLabel from '../migrations/20260930_000001_custom_endpoint_group_label.js';
import * as modelProbeStatus from '../migrations/20261007_000001_model_probe_status.js';
import * as searchEngines from '../migrations/20261013_000001_search_engines.js';
import * as decisionRequests from '../migrations/20261016_000001_decision_requests.js';
import * as llmtrReenableKeys from '../migrations/20261017_000001_llmtr_reenable_keys.js';
import * as removeGithubProvider from '../migrations/20261017_000002_remove_github_provider.js';
import * as requestFailureAttribution from '../migrations/20261017_233153_request_failure_attribution.js';
import * as removeAurayProvider from '../migrations/20261019_000001_remove_auray_provider.js';
import * as keyLastHealthyAt from '../migrations/20261020_000001_key_last_healthy_at.js';
import * as customMediaEndpointIdentity from '../migrations/20261028_000001_custom_media_endpoint_identity.js';
import * as cloudflareNeuronUsage from '../migrations/20261104_000001_cloudflare_neuron_usage.js';
import * as keyVerificationBasis from '../migrations/20261105_000001_key_verification_basis.js';
import * as modelMonthlyUsage from '../migrations/20261111_000001_model_monthly_usage.js';
import * as profileRoutingStrategy from '../migrations/20261111_000002_profile_routing_strategy.js';
import * as kiloFreeRefresh from '../migrations/20261117_000001_kilo_free_refresh.js';
import * as deepseekProvider from '../migrations/20261117_000002_deepseek_provider.js';
import * as agentRuntime from '../migrations/20261118_000001_agent_runtime.js';
import * as evalHarness from '../migrations/20261118_000002_eval_harness.js';
import * as semanticCache from '../migrations/20261118_000003_semantic_cache.js';
import * as agentSessions from '../migrations/20261118_000004_agent_sessions.js';
import * as mcpServers from '../migrations/20261118_000005_mcp_servers.js';
import * as agentGroups from '../migrations/20261118_000006_agent_groups.js';
import * as assistant from '../migrations/20261118_000007_assistant.js';
import * as checkpoints from '../migrations/20261118_000008_checkpoints.js';
import * as planMode from '../migrations/20261118_000009_plan_mode.js';
import * as subagents from '../migrations/20261118_000010_subagents.js';
import * as hooks from '../migrations/20261118_000011_hooks.js';
import * as evalAgents from '../migrations/20261118_000012_eval_agents.js';
import * as securityScans from '../migrations/20261118_000013_security_scans.js';
import * as docChunks from '../migrations/20261118_000014_doc_chunks.js';
import * as taskContracts from '../migrations/20261119_000015_task_contracts.js';
import * as personaRoster from '../migrations/20261119_000016_persona_roster.js';
import * as hierarchicalCrews from '../migrations/20261119_000017_hierarchical_crews.js';
import * as taskGuardrails from '../migrations/20261119_000018_task_guardrails.js';
import * as learningLoop from '../migrations/20261119_000019_learning_loop.js';
import * as taskOutputs from '../migrations/20261119_000020_task_outputs.js';
import * as skillBundles from '../migrations/20261119_000021_skill_bundles.js';

export interface MigrationModule {
  up(db: Db): void;
  down(db: Db): void;
}

export interface DefaultMigration {
  filename: string;
  module: MigrationModule;
}

export const LEGACY_BASELINE_FILENAME = '20260101_000000_legacy_baseline.ts';
export const CUSTOM_PROVIDER_MODALITIES_FILENAME = '20260627_000001_custom_provider_modalities.ts';
export const CATALOG_MODEL_STATE_FILENAME = '20260627_000002_catalog_model_state.ts';
export const REQUEST_AGGREGATES_FILENAME = '20260628_120000_request_aggregates.ts';
export const GITHUB_GPT41_CONTEXT_FILENAME = '20260630_000001_github_gpt41_context.ts';
export const REQUEST_CLIENT_INFO_FILENAME = '20260706_000001_request_client_info.ts';
export const CUSTOM_MODEL_TOOL_SUPPORT_FILENAME = '20260706_000002_custom_model_tool_support.ts';
export const PROFILE_CHAIN_BACKFILL_FILENAME = '20260714_000001_profile_chain_backfill.ts';
export const KEY_HEALTH_ERROR_FILENAME = '20260720_000001_key_health_error.ts';
export const COOLDOWN_PROBE_PROVENANCE_FILENAME = '20260726_000001_cooldown_probe_provenance.ts';
export const REQUEST_ATTEMPTS_FILENAME = '20260726_000002_request_attempts.ts';
export const MODEL_SOURCE_PROVENANCE_FILENAME = '20260726_000003_model_source_provenance.ts';
export const MEDIA_MODEL_META_FILENAME = '20260726_000004_media_model_meta.ts';
export const REQUEST_SERVED_MODEL_FILENAME = '20260726_000005_request_served_model.ts';
export const ATTEMPT_ERROR_SUMMARY_FILENAME = '20260726_000006_attempt_error_summary.ts';
export const AGENT_COMPATIBILITY_FILENAME = '20260727_000001_agent_compatibility.ts';
export const TOMBSTONE_PROVENANCE_FILENAME = '20260728_000001_tombstone_provenance.ts';
export const CUSTOM_MODEL_ENDPOINT_IDENTITY_FILENAME = '20260729_000001_custom_model_endpoint_identity.ts';
export const CUSTOM_ENDPOINT_HOST_LABELS_FILENAME = '20260802_000001_custom_endpoint_host_labels.ts';
export const KEY_MODEL_SCOPE_FILENAME = '20260805_000001_key_model_scope.ts';
export const CLIENT_PROFILES_FILENAME = '20260805_000002_client_profiles.ts';
export const API_KEY_PROXY_FILENAME = '20260810_000001_api_key_proxy.ts';
export const PLAYGROUND_CONVERSATIONS_FILENAME = '20260820_000001_playground_conversations.ts';
export const CUSTOM_MODEL_TOMBSTONES_FILENAME = '20260819_000001_custom_model_tombstones.ts';
export const SERVER_LOGS_FILENAME = '20260823_000001_server_logs.ts';
export const BACKUPS_TABLE_FILENAME = '20260823_000002_backups_table.ts';
export const ATTEMPT_KEY_LABEL_FILENAME = '20260823_000003_attempt_key_label.ts';
export const PROFILE_AUTO_INCLUDE_FILENAME = '20260823_000004_profile_auto_include.ts';
export const IDEMPOTENCY_CLAIMS_FILENAME = '20260901_000001_idempotency_claims.ts';
export const QUOTA_OBSERVATION_LOOKUP_FILENAME = '20260901_000002_quota_observation_lookup.ts';
export const REQUEST_CALLER_FILENAME = '20260901_000003_request_caller.ts';
export const ANALYTICS_LATENCY_PERCENTILE_INDEX_FILENAME = '20260902_000001_analytics_latency_percentile_index.ts';
export const MCP_ENABLED_DEFAULT_FILENAME = '20260903_000001_mcp_enabled_default.ts';
export const RESPONSE_CACHE_FILENAME = '20260903_000002_response_cache.ts';
export const KEY_MONTHLY_BUDGET_FILENAME = '20260904_000001_key_monthly_budget.ts';
export const REQUEST_MODEL_ATTRIBUTION_FILENAME = '20260913_000001_request_model_attribution.ts';
export const CUSTOM_ENDPOINT_GROUP_LABEL_FILENAME = '20260930_000001_custom_endpoint_group_label.ts';
export const MODEL_PROBE_STATUS_FILENAME = '20261007_000001_model_probe_status.ts';
export const KEY_MONTHLY_USAGE_FILENAME = '20260914_000001_key_monthly_usage.ts';
export const QUOTA_SNAPSHOT_FRESHNESS_FILENAME = '20260915_000001_quota_snapshot_freshness.ts';
export const SEARCH_ENGINES_FILENAME = '20261013_000001_search_engines.ts';
export const DECISION_REQUESTS_FILENAME = '20261016_000001_decision_requests.ts';
export const LLMTR_REENABLE_KEYS_FILENAME = '20261017_000001_llmtr_reenable_keys.ts';
export const REMOVE_GITHUB_PROVIDER_FILENAME = '20261017_000002_remove_github_provider.ts';
export const REQUEST_FAILURE_ATTRIBUTION_FILENAME = '20261017_233153_request_failure_attribution.ts';
export const REMOVE_AURAY_PROVIDER_FILENAME = '20261019_000001_remove_auray_provider.ts';
export const KEY_LAST_HEALTHY_AT_FILENAME = '20261020_000001_key_last_healthy_at.ts';
export const CLOUDFLARE_NEURON_USAGE_FILENAME = '20261104_000001_cloudflare_neuron_usage.ts';
export const KEY_VERIFICATION_BASIS_FILENAME = '20261105_000001_key_verification_basis.ts';
export const MODEL_MONTHLY_USAGE_FILENAME = '20261111_000001_model_monthly_usage.ts';
export const PROFILE_ROUTING_STRATEGY_FILENAME = '20261111_000002_profile_routing_strategy.ts';
export const KILO_FREE_REFRESH_FILENAME = '20261117_000001_kilo_free_refresh.ts';
export const DEEPSEEK_PROVIDER_FILENAME = '20261117_000002_deepseek_provider.ts';
export const AGENT_RUNTIME_FILENAME = '20261118_000001_agent_runtime.ts';
export const EVAL_HARNESS_FILENAME = '20261118_000002_eval_harness.ts';
export const SEMANTIC_CACHE_FILENAME = '20261118_000003_semantic_cache.ts';
export const AGENT_SESSIONS_FILENAME = '20261118_000004_agent_sessions.ts';
export const MCP_SERVERS_FILENAME = '20261118_000005_mcp_servers.ts';
export const AGENT_GROUPS_FILENAME = '20261118_000006_agent_groups.ts';
export const ASSISTANT_FILENAME = '20261118_000007_assistant.ts';
export const CHECKPOINTS_FILENAME = '20261118_000008_checkpoints.ts';
export const PLAN_MODE_FILENAME = '20261118_000009_plan_mode.ts';
export const SUBAGENTS_FILENAME = '20261118_000010_subagents.ts';
export const HOOKS_FILENAME = '20261118_000011_hooks.ts';
export const EVAL_AGENTS_FILENAME = '20261118_000012_eval_agents.ts';
export const SECURITY_SCANS_FILENAME = '20261118_000013_security_scans.ts';
export const DOC_CHUNKS_FILENAME = '20261118_000014_doc_chunks.ts';
export const TASK_CONTRACTS_FILENAME = '20261119_000015_task_contracts.ts';
export const PERSONA_ROSTER_FILENAME = '20261119_000016_persona_roster.ts';
export const HIERARCHICAL_CREWS_FILENAME = '20261119_000017_hierarchical_crews.ts';
export const TASK_GUARDRAILS_FILENAME = '20261119_000018_task_guardrails.ts';
export const LEARNING_LOOP_FILENAME = '20261119_000019_learning_loop.ts';
export const TASK_OUTPUTS_FILENAME = '20261119_000020_task_outputs.ts';
export const SKILL_BUNDLES_FILENAME = '20261119_000021_skill_bundles.ts';

export const DEFAULT_MIGRATIONS: readonly DefaultMigration[] = [
  { filename: LEGACY_BASELINE_FILENAME, module: legacyBaseline },
  { filename: CUSTOM_PROVIDER_MODALITIES_FILENAME, module: customProviderModalities },
  { filename: CATALOG_MODEL_STATE_FILENAME, module: catalogModelState },
  { filename: REQUEST_AGGREGATES_FILENAME, module: requestAggregates },
  { filename: GITHUB_GPT41_CONTEXT_FILENAME, module: githubGpt41Context },
  { filename: REQUEST_CLIENT_INFO_FILENAME, module: requestClientInfo },
  { filename: CUSTOM_MODEL_TOOL_SUPPORT_FILENAME, module: customModelToolSupport },
  { filename: PROFILE_CHAIN_BACKFILL_FILENAME, module: profileChainBackfill },
  { filename: KEY_HEALTH_ERROR_FILENAME, module: keyHealthError },
  { filename: COOLDOWN_PROBE_PROVENANCE_FILENAME, module: cooldownProbeProvenance },
  { filename: REQUEST_ATTEMPTS_FILENAME, module: requestAttempts },
  { filename: MODEL_SOURCE_PROVENANCE_FILENAME, module: modelSourceProvenance },
  { filename: MEDIA_MODEL_META_FILENAME, module: mediaModelMeta },
  { filename: REQUEST_SERVED_MODEL_FILENAME, module: requestServedModel },
  { filename: ATTEMPT_ERROR_SUMMARY_FILENAME, module: attemptErrorSummary },
  { filename: AGENT_COMPATIBILITY_FILENAME, module: agentCompatibility },
  { filename: TOMBSTONE_PROVENANCE_FILENAME, module: tombstoneProvenance },
  { filename: CUSTOM_MODEL_ENDPOINT_IDENTITY_FILENAME, module: customModelEndpointIdentity },
  { filename: CUSTOM_ENDPOINT_HOST_LABELS_FILENAME, module: customEndpointHostLabels },
  { filename: KEY_MODEL_SCOPE_FILENAME, module: keyModelScope },
  { filename: CLIENT_PROFILES_FILENAME, module: clientProfiles },
  { filename: API_KEY_PROXY_FILENAME, module: apiKeyProxy },
  { filename: CUSTOM_MODEL_TOMBSTONES_FILENAME, module: customModelTombstones },
  { filename: PLAYGROUND_CONVERSATIONS_FILENAME, module: playgroundConversations },
  { filename: SERVER_LOGS_FILENAME, module: serverLogs },
  { filename: BACKUPS_TABLE_FILENAME, module: backupsTable },
  { filename: ATTEMPT_KEY_LABEL_FILENAME, module: attemptKeyLabel },
  { filename: PROFILE_AUTO_INCLUDE_FILENAME, module: profileAutoInclude },
  { filename: IDEMPOTENCY_CLAIMS_FILENAME, module: idempotencyClaims },
  { filename: QUOTA_OBSERVATION_LOOKUP_FILENAME, module: quotaObservationLookup },
  { filename: REQUEST_CALLER_FILENAME, module: requestCaller },
  { filename: ANALYTICS_LATENCY_PERCENTILE_INDEX_FILENAME, module: analyticsLatencyPercentileIndex },
  { filename: MCP_ENABLED_DEFAULT_FILENAME, module: mcpEnabledDefault },
  { filename: RESPONSE_CACHE_FILENAME, module: responseCache },
  { filename: KEY_MONTHLY_BUDGET_FILENAME, module: keyMonthlyBudget },
  { filename: REQUEST_MODEL_ATTRIBUTION_FILENAME, module: requestModelAttribution },
  { filename: KEY_MONTHLY_USAGE_FILENAME, module: keyMonthlyUsage },
  { filename: QUOTA_SNAPSHOT_FRESHNESS_FILENAME, module: quotaSnapshotFreshness },
  { filename: CUSTOM_ENDPOINT_GROUP_LABEL_FILENAME, module: customEndpointGroupLabel },
  { filename: MODEL_PROBE_STATUS_FILENAME, module: modelProbeStatus },
  { filename: SEARCH_ENGINES_FILENAME, module: searchEngines },
  { filename: DECISION_REQUESTS_FILENAME, module: decisionRequests },
  { filename: LLMTR_REENABLE_KEYS_FILENAME, module: llmtrReenableKeys },
  { filename: REMOVE_GITHUB_PROVIDER_FILENAME, module: removeGithubProvider },
  { filename: REQUEST_FAILURE_ATTRIBUTION_FILENAME, module: requestFailureAttribution },
  { filename: REMOVE_AURAY_PROVIDER_FILENAME, module: removeAurayProvider },
  { filename: KEY_LAST_HEALTHY_AT_FILENAME, module: keyLastHealthyAt },
  { filename: '20261028_000001_custom_media_endpoint_identity.ts', module: customMediaEndpointIdentity },
  { filename: CLOUDFLARE_NEURON_USAGE_FILENAME, module: cloudflareNeuronUsage },
  { filename: KEY_VERIFICATION_BASIS_FILENAME, module: keyVerificationBasis },
  { filename: MODEL_MONTHLY_USAGE_FILENAME, module: modelMonthlyUsage },
  { filename: PROFILE_ROUTING_STRATEGY_FILENAME, module: profileRoutingStrategy },
  { filename: KILO_FREE_REFRESH_FILENAME, module: kiloFreeRefresh },
  { filename: DEEPSEEK_PROVIDER_FILENAME, module: deepseekProvider },
  { filename: AGENT_RUNTIME_FILENAME, module: agentRuntime },
  { filename: EVAL_HARNESS_FILENAME, module: evalHarness },
  { filename: SEMANTIC_CACHE_FILENAME, module: semanticCache },
  { filename: AGENT_SESSIONS_FILENAME, module: agentSessions },
  { filename: MCP_SERVERS_FILENAME, module: mcpServers },
  { filename: AGENT_GROUPS_FILENAME, module: agentGroups },
  { filename: ASSISTANT_FILENAME, module: assistant },
  { filename: CHECKPOINTS_FILENAME, module: checkpoints },
  { filename: PLAN_MODE_FILENAME, module: planMode },
  { filename: SUBAGENTS_FILENAME, module: subagents },
  { filename: HOOKS_FILENAME, module: hooks },
  { filename: EVAL_AGENTS_FILENAME, module: evalAgents },
  { filename: SECURITY_SCANS_FILENAME, module: securityScans },
  { filename: DOC_CHUNKS_FILENAME, module: docChunks },
  { filename: TASK_CONTRACTS_FILENAME, module: taskContracts },
  { filename: PERSONA_ROSTER_FILENAME, module: personaRoster },
  { filename: HIERARCHICAL_CREWS_FILENAME, module: hierarchicalCrews },
  { filename: TASK_GUARDRAILS_FILENAME, module: taskGuardrails },
  { filename: LEARNING_LOOP_FILENAME, module: learningLoop },
  { filename: TASK_OUTPUTS_FILENAME, module: taskOutputs },
  { filename: SKILL_BUNDLES_FILENAME, module: skillBundles },
];
