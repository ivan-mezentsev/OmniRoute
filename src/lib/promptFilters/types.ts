/**
 * Prompt Filters — shared types.
 *
 * A prompt filter removes user-defined instruction blocks from request
 * payloads when the client User-Agent matches one of the filter's wildcard
 * patterns. Excision happens once, before routing/translation, and is fully
 * deterministic so provider prompt caches keep stable prefixes.
 */

export type PromptFilterApplyTo = "system" | "all";

export interface PromptFilterBlock {
  /** Stable block id (UUID) — used for UI editing and reporting. */
  id: string;
  /** Verbatim instruction chunk to excise (whitespace-tolerant matching). */
  text: string;
}

export interface PromptFilter {
  id: string;
  name: string;
  enabled: boolean;
  /** Wildcard UA patterns (* / ?). Patterns without wildcards match as substring. */
  uaPatterns: string[];
  blocks: PromptFilterBlock[];
  applyTo: PromptFilterApplyTo;
  /** Number of requests where this filter removed at least one block. */
  matchCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface PromptFilterApplication {
  filterId: string;
  filterName: string;
  blockId: string;
  /** How many occurrences of this block were removed from the payload. */
  removals: number;
}

export interface PromptFilterResult {
  body: Record<string, unknown>;
  changed: boolean;
  totalRemovals: number;
  applications: PromptFilterApplication[];
  matchedFilters: Array<{ filterId: string; name: string }>;
}

/** Input shape for create/update operations (block ids optional on input). */
export interface PromptFilterInput {
  name: string;
  enabled?: boolean;
  uaPatterns: string[];
  blocks: Array<{ id?: string; text: string }>;
  applyTo?: PromptFilterApplyTo;
}
