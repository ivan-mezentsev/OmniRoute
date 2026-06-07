type JsonRecord = Record<string, unknown>;

type GeminiWebRawModel = {
  modelId: string;
  displayName: string;
  description: string;
  selector: number;
  raw: unknown[];
};

export type GeminiWebBootstrap = {
  accessToken: string;
  buildLabel: string;
  sessionId: string;
  language: string;
};

export type GeminiWebUserStatus = {
  statusCode: number;
  models: GeminiWebRawModel[];
  tierFlags: number[];
  capFlags: number[];
};

export const GEMINI_WEB_BASE_URL = "https://gemini.google.com";
export const GEMINI_WEB_APP_URL = `${GEMINI_WEB_BASE_URL}/app`;
export const GEMINI_WEB_GET_USER_STATUS_RPC_ID = "otAQ7b";
export const GEMINI_WEB_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function toNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    const normalized = toNonEmptyString(value);
    if (normalized) return normalized;
  }
  return "";
}

export function buildGeminiWebCookieHeader(rawCredential: string | null | undefined): string {
  const raw = typeof rawCredential === "string" ? rawCredential.trim() : "";
  if (!raw) return "";

  const withoutPrefix = raw.replace(/^cookie\s*:/i, "").trim();
  if (!withoutPrefix.includes("=")) {
    return `__Secure-1PSID=${withoutPrefix}`;
  }
  return withoutPrefix;
}

export function buildGeminiWebBootstrapHeaders(cookieHeader: string): Record<string, string> {
  return {
    Accept: "text/html,application/xhtml+xml",
    Cookie: cookieHeader,
    Origin: GEMINI_WEB_BASE_URL,
    Referer: `${GEMINI_WEB_BASE_URL}/`,
    "User-Agent": GEMINI_WEB_USER_AGENT,
  };
}

export function extractGeminiWebBootstrap(html: string): GeminiWebBootstrap | null {
  const accessToken = html.match(/"SNlM0e"\s*:\s*"([^"]+)"/)?.[1] || "";
  if (!accessToken) return null;

  const buildLabel = html.match(/"cfb2h"\s*:\s*"([^"]+)"/)?.[1] || "";
  const sessionId = html.match(/"FdrFJe"\s*:\s*"([^"]+)"/)?.[1] || "";
  const language = html.match(/"TuX5cc"\s*:\s*"([^"]+)"/)?.[1] || "en";

  return {
    accessToken,
    buildLabel,
    sessionId,
    language,
  };
}

export function buildGeminiWebBatchUrl({
  language,
  buildLabel,
  sessionId,
  accountPath = "",
  sourcePath,
}: {
  language?: string;
  buildLabel?: string;
  sessionId?: string;
  accountPath?: string;
  sourcePath?: string;
}): string {
  const normalizedAccountPath = accountPath.startsWith("/u/") ? accountPath : "";
  const params = new URLSearchParams();
  params.set("rpcids", GEMINI_WEB_GET_USER_STATUS_RPC_ID);
  params.set("_reqid", `${10000 + Math.floor(Math.random() * 90000)}`);
  params.set("rt", "c");
  params.set("hl", language || "en");
  params.set("pageId", "none");
  params.set("source-path", sourcePath || `${normalizedAccountPath}/app` || "/app");
  if (buildLabel) params.set("bl", buildLabel);
  if (sessionId) params.set("f.sid", sessionId);

  return `${GEMINI_WEB_BASE_URL}${normalizedAccountPath}/_/BardChatUi/data/batchexecute?${params.toString()}`;
}

export function extractGeminiWebAccountPath(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    return pathname.match(/^\/u\/\d+/)?.[0] || "";
  } catch {
    return "";
  }
}

export function buildGeminiWebGetUserStatusBody(accessToken: string): string {
  const requestPayload = [[[GEMINI_WEB_GET_USER_STATUS_RPC_ID, "[]", null, "generic"]]];
  const form = new URLSearchParams();
  form.set("at", accessToken);
  form.set("f.req", JSON.stringify(requestPayload));
  return form.toString();
}

export function buildGeminiWebBatchHeaders(cookieHeader: string): Record<string, string> {
  return {
    "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
    Cookie: cookieHeader,
    Host: "gemini.google.com",
    Origin: GEMINI_WEB_BASE_URL,
    Referer: `${GEMINI_WEB_BASE_URL}/`,
    "User-Agent": GEMINI_WEB_USER_AGENT,
    "X-Same-Domain": "1",
  };
}

export function stripGeminiWebResponsePrefix(responseText: string): string {
  return responseText.startsWith(")]}\'\n") ? responseText.slice(5) : responseText;
}

export function parseGeminiWebLengthPrefixedFrames(responseText: string): string[] {
  const frames: string[] = [];
  const input = stripGeminiWebResponsePrefix(responseText);
  let pos = 0;

  while (pos < input.length) {
    while (pos < input.length && /[\s\r\n\t]/.test(input[pos])) pos += 1;
    if (pos >= input.length) break;

    const numberStart = pos;
    while (pos < input.length && /[0-9]/.test(input[pos])) pos += 1;
    if (pos === numberStart) {
      pos += 1;
      continue;
    }

    if (pos >= input.length || input[pos] !== "\n") break;
    const utf16Units = Number.parseInt(input.slice(numberStart, pos), 10);
    if (!Number.isFinite(utf16Units) || utf16Units <= 0) break;

    const contentStart = pos;
    const contentEnd = contentStart + utf16Units;
    if (contentEnd > input.length) break;

    const chunk = input.slice(contentStart, contentEnd).trim();
    if (chunk) frames.push(chunk);
    pos = contentEnd;
  }

  return frames;
}

function findWrbFrItems(value: unknown): unknown[][] {
  const root = Array.isArray(value) ? value : [];
  const matches: unknown[][] = [];

  for (const item of root) {
    if (!Array.isArray(item)) continue;
    if (item.length >= 2 && item[0] === "wrb.fr") {
      matches.push(item);
      continue;
    }
    for (const child of item) {
      if (Array.isArray(child) && child.length >= 2 && child[0] === "wrb.fr") {
        matches.push(child);
      }
    }
  }

  return matches;
}

export function extractGeminiWebRpcBody(
  responseText: string,
  rpcId: string = GEMINI_WEB_GET_USER_STATUS_RPC_ID
): { body: string; rejectCode: number } | null {
  for (const frame of parseGeminiWebLengthPrefixedFrames(responseText)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(frame);
    } catch {
      continue;
    }

    for (const item of findWrbFrItems(parsed)) {
      if (item.length < 3) continue;
      const tag = typeof item[0] === "string" ? item[0] : "";
      const id = typeof item[1] === "string" ? item[1] : "";
      if (tag !== "wrb.fr" || id !== rpcId) continue;

      const body = typeof item[2] === "string" ? item[2] : "";
      const codeArray = Array.isArray(item[5]) ? item[5] : [];
      const rejectCode = typeof codeArray[0] === "number" ? Number(codeArray[0]) : 0;
      return { body, rejectCode };
    }
  }

  return null;
}

function arrayAt(root: unknown, ...path: number[]): unknown[] | null {
  let current: unknown = root;
  for (const index of path) {
    if (!Array.isArray(current) || index < 0 || index >= current.length) return null;
    current = current[index];
  }
  return Array.isArray(current) ? current : null;
}

function stringAt(root: unknown, ...path: number[]): string {
  let current: unknown = root;
  for (const index of path) {
    if (!Array.isArray(current) || index < 0 || index >= current.length) return "";
    current = current[index];
  }
  return typeof current === "string" ? current : "";
}

function intAt(root: unknown, ...path: number[]): number {
  let current: unknown = root;
  for (const index of path) {
    if (!Array.isArray(current) || index < 0 || index >= current.length) return 0;
    current = current[index];
  }
  return typeof current === "number" && Number.isFinite(current) ? current : 0;
}

export function parseGeminiWebUserStatus(bodyText: string): GeminiWebUserStatus {
  const trimmed = bodyText.trim();
  if (!trimmed || trimmed === "[]") {
    return { statusCode: 1000, models: [], tierFlags: [], capFlags: [] };
  }

  const parsed = JSON.parse(trimmed) as unknown[];
  const statusCode = intAt(parsed, 14) || 1000;
  const rawModels = arrayAt(parsed, 15) || [];
  const tierFlags = (arrayAt(parsed, 16) || []).filter(
    (value): value is number => typeof value === "number"
  );
  const capFlags = (arrayAt(parsed, 17) || []).filter(
    (value): value is number => typeof value === "number"
  );

  const models: GeminiWebRawModel[] = rawModels
    .filter(Array.isArray)
    .map((model) => ({
      modelId: stringAt(model, 0),
      displayName: stringAt(model, 1),
      description: stringAt(model, 2),
      selector: intAt(model, 17),
      raw: model,
    }))
    .filter((model) => model.modelId && model.displayName);

  return { statusCode, models, tierFlags, capFlags };
}

function normalizeGeminiWebModelId(rawModel: GeminiWebRawModel): string {
  const candidates = [19, 11, 10, 1]
    .map((index) => (index < rawModel.raw.length ? rawModel.raw[index] : ""))
    .map((value) => (typeof value === "string" ? value : ""))
    .filter(Boolean);

  for (const candidate of candidates) {
    let name = candidate.trim().toLowerCase();
    if (!name) continue;
    name = name.replace(/\s+/g, "-").replace(/_/g, "-").replace(/^-+|-+$/g, "");
    if (!name.startsWith("gemini-")) name = `gemini-${name}`;
    return name;
  }

  const fallback = rawModel.displayName.trim().toLowerCase().replace(/\s+/g, "-");
  return fallback.startsWith("gemini-") ? fallback : `gemini-${fallback}`;
}

function humanizeGeminiWebModelName(id: string, displayName: string): string {
  if (/^gemini\b/i.test(displayName)) return displayName;

  const base = id.replace(/^gemini-/, "");
  const words = base.split("-").filter(Boolean).map((part) => {
    if (/^\d+(?:\.\d+)?$/.test(part)) return part;
    return part.charAt(0).toUpperCase() + part.slice(1);
  });

  return words.length > 0 ? `Gemini ${words.join(" ")}` : displayName;
}

export function normalizeGeminiWebDiscoveredModels(
  userStatus: GeminiWebUserStatus
): Array<{ id: string; name: string; description?: string; supportsThinking?: boolean }> {
  const deduped = new Map<
    string,
    { id: string; name: string; description?: string; supportsThinking?: boolean }
  >();

  for (const model of userStatus.models) {
    const id = normalizeGeminiWebModelId(model);
    if (!id || deduped.has(id)) continue;
    deduped.set(id, {
      id,
      name: humanizeGeminiWebModelName(id, model.displayName),
      ...(model.description ? { description: model.description } : {}),
      ...(/thinking/i.test(model.displayName) || /thinking/i.test(id)
        ? { supportsThinking: true }
        : {}),
    });
  }

  return Array.from(deduped.values());
}
