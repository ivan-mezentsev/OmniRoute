import { getEnabledPromptFilters, recordPromptFilterMatches } from "@/lib/db/promptFilters";
import type {
  PromptFilter,
  PromptFilterApplication,
  PromptFilterResult,
} from "@/lib/promptFilters/types";
import { wildcardMatch } from "@omniroute/open-sse/services/wildcardRouter.ts";

type JsonRecord = Record<string, unknown>;

type TextVisit = {
  value: string;
  set: (next: string) => void;
  role?: string;
};

const PROMPT_FILTER_CACHE_TTL_MS = 10_000;
const MATCH_RECORD_FLUSH_MS = 5_000;
const SYSTEM_ROLES = new Set(["system", "developer"]);

let filtersCache: PromptFilter[] | null = null;
let filtersCacheTs = 0;
let filtersCachePromise: Promise<PromptFilter[]> | null = null;

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function cloneBody(body: Record<string, unknown>): Record<string, unknown> {
  return structuredClone(body);
}

function getRole(item: unknown): string | undefined {
  if (!isRecord(item)) return undefined;
  const role = item.role;
  return typeof role === "string" ? role : undefined;
}

function shouldVisitRole(role: string | undefined, applyTo: PromptFilter["applyTo"]): boolean {
  return applyTo === "all" || (typeof role === "string" && SYSTEM_ROLES.has(role));
}

/**
 * Unescape JSON-style literal escape sequences in a single left-to-right pass
 * so an escaped backslash (`\\`) is consumed first and never re-interpreted
 * as the start of another escape (user-pasted `\\n` stays backslash + "n").
 * `\b` / `\f` are intentionally NOT unescaped: raw Windows paths such as
 * `C:\bin` or `C:\foo` would otherwise turn into control characters and
 * silently break matching.
 */
function unescapeJsonLikeLiterals(input: string): string {
  return input.replace(/\\(u[0-9a-fA-F]{4}|[\\/"nrt])/g, (_match, seq: string) => {
    if (seq.startsWith("u")) return String.fromCharCode(Number.parseInt(seq.slice(1), 16));
    switch (seq) {
      case "n":
        return "\n";
      case "r":
        return "\r";
      case "t":
        return "\t";
      case '"':
        return '"';
      case "/":
        return "/";
      default:
        return "\\";
    }
  });
}

function normalizePatternText(input: string): string {
  return unescapeJsonLikeLiterals(input).replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
}

function escapeRegexLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildWhitespaceTolerantRegex(pattern: string): RegExp | null {
  const normalized = normalizePatternText(pattern);
  if (!normalized) return null;

  let source = "";
  let lastWasWhitespace = false;

  for (const char of normalized) {
    if (/\s/u.test(char)) {
      if (!lastWasWhitespace) {
        source += "\\s+";
        lastWasWhitespace = true;
      }
      continue;
    }

    source += escapeRegexLiteral(char);
    lastWasWhitespace = false;
  }

  return new RegExp(source, "gu");
}

/**
 * Collapse whitespace only at the junction produced by a removal so that
 * indentation and spacing everywhere else in the text stay byte-for-byte
 * identical (markdown lists, code samples, etc. are preserved).
 */
function collapseJunctionWhitespace(left: string, right: string): string {
  const leftWs = left.match(/[ \t\n]*$/)?.[0] ?? "";
  const rightWs = right.match(/^[ \t\n]*/)?.[0] ?? "";
  if (!leftWs && !rightWs) return left + right;

  const collapsed = (leftWs + rightWs)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n");

  return left.slice(0, left.length - leftWs.length) + collapsed + right.slice(rightWs.length);
}

function removeBlockFromText(value: string, blockText: string): { text: string; removals: number } {
  const regex = buildWhitespaceTolerantRegex(blockText);
  if (!regex) return { text: value, removals: 0 };

  const segments: string[] = [];
  let cursor = 0;
  let removals = 0;

  for (const match of value.matchAll(regex)) {
    const index = match.index ?? 0;
    segments.push(value.slice(cursor, index));
    cursor = index + match[0].length;
    removals += 1;
  }

  if (removals === 0) return { text: value, removals: 0 };
  segments.push(value.slice(cursor));

  let text = segments[0];
  for (let i = 1; i < segments.length; i += 1) {
    text = collapseJunctionWhitespace(text, segments[i]);
  }
  return { text, removals };
}

/**
 * Match a User-Agent against filter patterns (case-insensitive).
 * NOTE: matching is intentionally wider than strict glob — a wildcard
 * pattern also matches anywhere inside the UA (`Copilot*` matches
 * `GitHubCopilotChat/1.0`), and plain patterns match as substrings.
 */
function userAgentMatches(userAgent: string, patterns: string[]): boolean {
  const normalizedUserAgent = userAgent.trim().toLowerCase();
  if (!normalizedUserAgent) return false;

  return patterns.some((pattern) => {
    const trimmed = pattern.trim();
    if (!trimmed) return false;
    const normalizedPattern = trimmed.toLowerCase();
    if (normalizedPattern.includes("*") || normalizedPattern.includes("?")) {
      return (
        wildcardMatch(normalizedUserAgent, normalizedPattern) ||
        wildcardMatch(normalizedUserAgent, `*${normalizedPattern}`)
      );
    }
    return normalizedUserAgent.includes(normalizedPattern);
  });
}

function visitContentText(content: unknown, role: string | undefined, visits: TextVisit[]): void {
  if (typeof content === "string") {
    return;
  }

  if (!Array.isArray(content)) {
    return;
  }

  for (const block of content) {
    if (!isRecord(block)) continue;
    if (typeof block.text === "string") {
      visits.push({
        value: block.text,
        role,
        set: (next) => {
          block.text = next;
        },
      });
    }
  }
}

function collectTextVisits(body: Record<string, unknown>): TextVisit[] {
  const visits: TextVisit[] = [];

  if (typeof body.instructions === "string") {
    visits.push({
      value: body.instructions,
      role: "system",
      set: (next) => {
        body.instructions = next;
      },
    });
  }

  if (typeof body.system === "string") {
    visits.push({
      value: body.system,
      role: "system",
      set: (next) => {
        body.system = next;
      },
    });
  } else if (Array.isArray(body.system)) {
    visitContentText(body.system, "system", visits);
  }

  if (Array.isArray(body.messages)) {
    for (const message of body.messages) {
      if (!isRecord(message)) continue;
      const role = getRole(message);
      if (typeof message.content === "string") {
        visits.push({
          value: message.content,
          role,
          set: (next) => {
            message.content = next;
          },
        });
      } else {
        visitContentText(message.content, role, visits);
      }
    }
  }

  if (Array.isArray(body.input)) {
    const input = body.input as unknown[];
    for (let index = 0; index < input.length; index += 1) {
      const item = input[index];
      if (typeof item === "string") {
        // Capture the index at collection time: the array slot is rewritten
        // after the first removal, so an indexOf lookup would miss later ones.
        const itemIndex = index;
        visits.push({
          value: item,
          role: "user",
          set: (next) => {
            input[itemIndex] = next;
          },
        });
        continue;
      }
      if (!isRecord(item)) continue;
      const role = getRole(item);
      if (typeof item.content === "string") {
        visits.push({
          value: item.content,
          role,
          set: (next) => {
            item.content = next;
          },
        });
      } else {
        visitContentText(item.content, role, visits);
      }
    }
  }

  return visits;
}

async function getFiltersCached(forceRefresh = false): Promise<PromptFilter[]> {
  const now = Date.now();
  if (!forceRefresh && filtersCache && now - filtersCacheTs < PROMPT_FILTER_CACHE_TTL_MS) {
    return filtersCache;
  }

  if (filtersCachePromise) {
    return filtersCachePromise;
  }

  filtersCachePromise = Promise.resolve()
    .then(() => getEnabledPromptFilters())
    .then((filters) => {
      filtersCache = filters;
      filtersCacheTs = Date.now();
      return filters;
    })
    .finally(() => {
      filtersCachePromise = null;
    });

  return filtersCachePromise;
}

export function invalidatePromptFiltersCache(): void {
  filtersCache = null;
  filtersCacheTs = 0;
  filtersCachePromise = null;
}

// ── Match-count bookkeeping ──────────────────────────────────────────────────
// Increments are accumulated in memory and flushed in one batched transaction
// off the hot path, so request handling never blocks on a stats-only write.

const pendingMatchCounts = new Map<string, number>();
let matchFlushTimer: ReturnType<typeof setTimeout> | null = null;

function queueMatchRecords(filterIds: Iterable<string>): void {
  for (const id of filterIds) {
    pendingMatchCounts.set(id, (pendingMatchCounts.get(id) || 0) + 1);
  }
  if (pendingMatchCounts.size > 0 && !matchFlushTimer) {
    matchFlushTimer = setTimeout(() => {
      matchFlushTimer = null;
      flushPromptFilterMatchCounts();
    }, MATCH_RECORD_FLUSH_MS);
    // Never keep the process alive for stats bookkeeping.
    (matchFlushTimer as unknown as { unref?: () => void }).unref?.();
  }
}

/** Flush queued match-count increments to SQLite (exported for tests/shutdown). */
export function flushPromptFilterMatchCounts(): void {
  if (pendingMatchCounts.size === 0) return;
  const entries = Array.from(pendingMatchCounts.entries()).map(([filterId, count]) => ({
    filterId,
    count,
  }));
  pendingMatchCounts.clear();
  try {
    recordPromptFilterMatches(entries);
  } catch (error) {
    // Stats-only write — never let bookkeeping break the request path.
    console.error("[prompt-filters] failed to flush match counts:", error);
  }
}

export function applyPromptFiltersToBody(
  body: Record<string, unknown>,
  userAgent: string,
  filters: PromptFilter[],
  options: { recordMatches?: boolean } = {}
): PromptFilterResult {
  const matchedFilters = filters.filter(
    (filter) => filter.enabled && userAgentMatches(userAgent, filter.uaPatterns)
  );

  if (matchedFilters.length === 0) {
    return {
      body,
      changed: false,
      totalRemovals: 0,
      applications: [],
      matchedFilters: [],
    };
  }

  const nextBody = cloneBody(body);
  const visits = collectTextVisits(nextBody);
  const applications: PromptFilterApplication[] = [];
  const matchedWithRemoval = new Set<string>();
  let totalRemovals = 0;

  for (const filter of matchedFilters) {
    for (const block of filter.blocks) {
      let blockRemovals = 0;
      for (const visit of visits) {
        if (!shouldVisitRole(visit.role, filter.applyTo)) continue;
        const result = removeBlockFromText(visit.value, block.text);
        if (result.removals === 0) continue;
        visit.value = result.text;
        visit.set(result.text);
        blockRemovals += result.removals;
      }

      if (blockRemovals > 0) {
        matchedWithRemoval.add(filter.id);
        totalRemovals += blockRemovals;
        applications.push({
          filterId: filter.id,
          filterName: filter.name,
          blockId: block.id,
          removals: blockRemovals,
        });
      }
    }
  }

  if (options.recordMatches && matchedWithRemoval.size > 0) {
    queueMatchRecords(matchedWithRemoval);
  }

  return {
    body: nextBody,
    changed: totalRemovals > 0,
    totalRemovals,
    applications,
    matchedFilters: matchedFilters.map((filter) => ({ filterId: filter.id, name: filter.name })),
  };
}

export async function applyPromptFilters(
  body: Record<string, unknown>,
  userAgent: string
): Promise<PromptFilterResult> {
  const filters = await getFiltersCached();
  return applyPromptFiltersToBody(body, userAgent, filters, { recordMatches: true });
}

export async function previewPromptFilters(
  body: Record<string, unknown>,
  userAgent: string
): Promise<PromptFilterResult> {
  const filters = await getFiltersCached(true);
  return applyPromptFiltersToBody(body, userAgent, filters, { recordMatches: false });
}
