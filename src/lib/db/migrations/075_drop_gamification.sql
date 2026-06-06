-- Migration 075: Drop gamification & leaderboard system
--
-- Removes all tables and indexes created by migration 060 (Gamification &
-- Leaderboard). The gamification feature has been removed from the codebase,
-- so this migration cleans up the schema and data on existing databases.
--
-- Safe to run on databases that never had migration 060 applied: every
-- statement uses IF EXISTS.

DROP INDEX IF EXISTS idx_leaderboard_scope_score;
DROP INDEX IF EXISTS idx_user_badges_badge_id;
DROP INDEX IF EXISTS idx_xp_audit_log_api_key_created;
DROP INDEX IF EXISTS idx_invite_tokens_code;
DROP INDEX IF EXISTS idx_invite_tokens_token_hash;

DROP TABLE IF EXISTS leaderboard;
DROP TABLE IF EXISTS user_levels;
DROP TABLE IF EXISTS user_badges;
DROP TABLE IF EXISTS badge_definitions;
DROP TABLE IF EXISTS xp_audit_log;
DROP TABLE IF EXISTS token_ledger;
DROP TABLE IF EXISTS invite_tokens;
DROP TABLE IF EXISTS community_servers;
