// Migration: MCP server registry (Phase 2).
//
// Outbound MCP connections the agent loop can use: local stdio servers
// (command + args + env) and remote Streamable HTTP servers (url +
// headers). Env vars and headers may carry secrets, so they are stored
// encrypted with the gateway key, mirroring api_keys. last_error records
// the most recent connection failure for the dashboard.

import type { Db } from '../types.js';

export function up(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS mcp_servers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      transport TEXT NOT NULL DEFAULT 'stdio',
      command TEXT NOT NULL DEFAULT '',
      args_json TEXT NOT NULL DEFAULT '[]',
      url TEXT NOT NULL DEFAULT '',
      env_encrypted TEXT,
      env_iv TEXT,
      env_auth_tag TEXT,
      headers_encrypted TEXT,
      headers_iv TEXT,
      headers_auth_tag TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_error TEXT,
      last_seen_at TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
  `);
}

export function down(db: Db): void {
  db.exec('DROP TABLE IF EXISTS mcp_servers;');
}
