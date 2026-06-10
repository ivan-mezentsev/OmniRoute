-- Migration 093: Prompt Filters
-- Per-User-Agent system-instruction excision rules.
-- Each filter targets client User-Agents via wildcard patterns and removes
-- user-defined instruction blocks from request payloads before routing.

CREATE TABLE IF NOT EXISTS prompt_filters (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  -- JSON array of wildcard UA patterns, e.g. ["Copilot*", "OpenCode*"]
  ua_patterns TEXT NOT NULL DEFAULT '[]',
  -- JSON array of { id, text } blocks to excise from matching payloads
  blocks TEXT NOT NULL DEFAULT '[]',
  -- 'system' = system/developer messages only, 'all' = every message
  apply_to TEXT NOT NULL DEFAULT 'system' CHECK(apply_to IN ('system', 'all')),
  match_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_prompt_filters_enabled
  ON prompt_filters(enabled);
