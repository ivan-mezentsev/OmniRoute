import { randomUUID } from "node:crypto";

import { getDbInstance } from "./core";
import type {
  PromptFilter,
  PromptFilterBlock,
  PromptFilterInput,
  PromptFilterApplyTo,
} from "@/lib/promptFilters/types";

interface PromptFilterRow {
  id: string;
  name: string;
  enabled: number;
  ua_patterns: string;
  blocks: string;
  apply_to: string;
  match_count: number;
  created_at: string;
  updated_at: string;
}

function parseJsonArray<T>(value: string, fallback: T[]): T[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as T[]) : fallback;
  } catch {
    return fallback;
  }
}

function normalizeBlocks(blocks: Array<{ id?: string; text: string }>): PromptFilterBlock[] {
  return blocks
    .map((block) => ({
      id: typeof block.id === "string" && block.id.trim() ? block.id.trim() : randomUUID(),
      text: typeof block.text === "string" ? block.text : "",
    }))
    .filter((block) => block.text.trim().length > 0);
}

function normalizeUaPatterns(patterns: string[]): string[] {
  return patterns
    .map((pattern) => pattern.trim())
    .filter(Boolean)
    .filter((pattern, index, all) => all.indexOf(pattern) === index);
}

function rowToPromptFilter(row: PromptFilterRow): PromptFilter {
  return {
    id: row.id,
    name: row.name,
    enabled: row.enabled === 1,
    uaPatterns: parseJsonArray<string>(row.ua_patterns, []),
    blocks: parseJsonArray<PromptFilterBlock>(row.blocks, []),
    applyTo: row.apply_to === "all" ? "all" : "system",
    matchCount: row.match_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function normalizePromptFilterInput(input: PromptFilterInput): PromptFilterInput {
  return {
    name: input.name.trim(),
    enabled: input.enabled ?? true,
    uaPatterns: normalizeUaPatterns(input.uaPatterns),
    blocks: normalizeBlocks(input.blocks),
    applyTo: input.applyTo === "all" ? "all" : "system",
  };
}

export function getPromptFilters(): PromptFilter[] {
  const db = getDbInstance();
  const rows = db
    .prepare("SELECT * FROM prompt_filters ORDER BY created_at DESC, name ASC")
    .all() as PromptFilterRow[];
  return rows.map(rowToPromptFilter);
}

export function getEnabledPromptFilters(): PromptFilter[] {
  const db = getDbInstance();
  const rows = db
    .prepare(
      "SELECT * FROM prompt_filters WHERE enabled = 1 ORDER BY created_at ASC, name ASC"
    )
    .all() as PromptFilterRow[];
  return rows.map(rowToPromptFilter);
}

export function getPromptFilter(id: string): PromptFilter | null {
  const db = getDbInstance();
  const row = db.prepare("SELECT * FROM prompt_filters WHERE id = ?").get(id) as
    | PromptFilterRow
    | undefined;
  return row ? rowToPromptFilter(row) : null;
}

export function createPromptFilter(input: PromptFilterInput): PromptFilter {
  const db = getDbInstance();
  const normalized = normalizePromptFilterInput(input);
  const id = randomUUID();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO prompt_filters
      (id, name, enabled, ua_patterns, blocks, apply_to, match_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`
  ).run(
    id,
    normalized.name,
    normalized.enabled ? 1 : 0,
    JSON.stringify(normalized.uaPatterns),
    JSON.stringify(normalized.blocks),
    normalized.applyTo as PromptFilterApplyTo,
    now,
    now
  );

  return getPromptFilter(id)!;
}

export function updatePromptFilter(
  id: string,
  input: Partial<PromptFilterInput>
): PromptFilter | null {
  const db = getDbInstance();
  const existing = getPromptFilter(id);
  if (!existing) return null;

  const merged = normalizePromptFilterInput({
    name: input.name ?? existing.name,
    enabled: input.enabled ?? existing.enabled,
    uaPatterns: input.uaPatterns ?? existing.uaPatterns,
    blocks: input.blocks ?? existing.blocks,
    applyTo: input.applyTo ?? existing.applyTo,
  });

  db.prepare(
    `UPDATE prompt_filters SET
      name = ?,
      enabled = ?,
      ua_patterns = ?,
      blocks = ?,
      apply_to = ?,
      updated_at = ?
     WHERE id = ?`
  ).run(
    merged.name,
    merged.enabled ? 1 : 0,
    JSON.stringify(merged.uaPatterns),
    JSON.stringify(merged.blocks),
    merged.applyTo,
    new Date().toISOString(),
    id
  );

  return getPromptFilter(id);
}

export function deletePromptFilter(id: string): boolean {
  const db = getDbInstance();
  const result = db.prepare("DELETE FROM prompt_filters WHERE id = ?").run(id);
  return result.changes > 0;
}

export function recordPromptFilterMatches(
  entries: Array<{ filterId: string; count: number }>
): void {
  const valid = entries.filter((entry) => entry.filterId && entry.count > 0);
  if (valid.length === 0) return;

  const db = getDbInstance();
  // NOTE: deliberately does not touch updated_at — that column tracks config
  // edits, not traffic.
  const update = db.prepare("UPDATE prompt_filters SET match_count = match_count + ? WHERE id = ?");
  const transaction = db.transaction((rows: Array<{ filterId: string; count: number }>) => {
    for (const row of rows) update.run(row.count, row.filterId);
  });
  transaction(valid);
}
