type JsonRecord = Record<string, unknown>;

export const KIMI_WEB_BASE_URL = "https://www.kimi.com";
export const KIMI_WEB_CHAT_PATH = "/apiv2/kimi.gateway.chat.v1.ChatService/Chat";
export const KIMI_WEB_MODELS_PATH =
  "/apiv2/kimi.gateway.config.v1.ConfigService/GetAvailableModels";

const KIMI_WEB_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const THINKING_STAGE_NAME = "STAGE_NAME_THINKING";
const LEGACY_MODEL_ALIASES: Record<string, string> = {
  "kimi-default": "kimi-k2.6",
  "kimi-128k": "kimi-k2.6",
  "kimi-k2.6-instant": "kimi-k2.6",
  k2d6: "kimi-k2.6",
  "k2d6-thinking": "kimi-k2.6-thinking",
  "k2d6-agent": "kimi-k2.6-agent",
  "k2d6-agent-ultra": "kimi-k2.6-agent-swarm",
};

type KimiWebPhase = "thinking" | "answer" | null;

export type KimiWebAuthContext = {
  token: string | null;
  cookieHeader: string | null;
  deviceId: string | null;
  sessionId: string | null;
};

export type KimiConnectFrame = {
  flag: number;
  event: JsonRecord | null;
  rawText: string;
};

export type KimiWebCatalogModel = {
  id: string;
  name: string;
  scenario: string;
  thinking: boolean;
  supportsThinking?: boolean;
  description?: string;
  inputPlaceholder?: string;
  kimiPlusId?: string;
  agentMode?: string;
  rawKey?: string;
};

export type KimiWebResolvedModel = {
  id: string;
  name: string;
  scenario: string;
  thinking: boolean;
  useSearch: boolean;
  kimiPlusId?: string;
  agentMode?: string;
};

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function toNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toRawNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function normalizeCookieInput(rawCredential: string | null | undefined): string {
  const raw = typeof rawCredential === "string" ? rawCredential.trim() : "";
  if (!raw) return "";

  const withoutPrefix = raw.replace(/^cookie\s*:/i, "").trim();
  if (!withoutPrefix.includes("\n")) return withoutPrefix;

  const lines = withoutPrefix
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const pairs = lines.map((line) => {
    if (line.includes("=")) return line;
    const firstWhitespace = line.search(/\s/);
    if (firstWhitespace === -1) return line;
    const name = line.slice(0, firstWhitespace).trim();
    const value = line.slice(firstWhitespace).trim();
    return name && value ? `${name}=${value}` : line;
  });

  return pairs.join("; ");
}

function parseCookieHeader(cookieHeader: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of cookieHeader.split(/;\s*/)) {
    if (!part) continue;
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (name) cookies[name] = value;
  }
  return cookies;
}

function isLikelyJwtToken(value: string): boolean {
  return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value);
}

export function decodeKimiJwt(token: string | null | undefined): JsonRecord | null {
  if (!token || !isLikelyJwtToken(token)) return null;

  try {
    const [, payload] = token.split(".");
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as JsonRecord;
  } catch {
    return null;
  }
}

export function parseKimiWebAuth(rawCredential: string | null | undefined): KimiWebAuthContext {
  const normalized = normalizeCookieInput(rawCredential);
  if (!normalized) {
    return {
      token: null,
      cookieHeader: null,
      deviceId: null,
      sessionId: null,
    };
  }

  const looksLikeCookieJar = normalized.includes("=") || normalized.includes(";");
  const cookieHeader = looksLikeCookieJar ? normalized : `kimi-auth=${normalized}`;
  const cookies = parseCookieHeader(cookieHeader);
  const token = toNonEmptyString(cookies["kimi-auth"]) || (isLikelyJwtToken(normalized) ? normalized : null);
  const claims = decodeKimiJwt(token);

  return {
    token,
    cookieHeader,
    deviceId: toNonEmptyString(claims?.device_id),
    sessionId: toNonEmptyString(claims?.ssid),
  };
}

function buildBaseHeaders(auth: KimiWebAuthContext): Record<string, string> {
  const headers: Record<string, string> = {
    Origin: KIMI_WEB_BASE_URL,
    Referer: `${KIMI_WEB_BASE_URL}/`,
    "X-Language": "en-US",
    "X-Msh-Platform": "web",
    "User-Agent": KIMI_WEB_USER_AGENT,
  };

  if (auth.token) headers.Authorization = `Bearer ${auth.token}`;
  if (auth.cookieHeader) headers.Cookie = auth.cookieHeader;
  if (auth.deviceId) headers["X-Msh-Device-Id"] = auth.deviceId;
  if (auth.sessionId) headers["X-Msh-Session-Id"] = auth.sessionId;

  return headers;
}

export function buildKimiWebDiscoveryHeaders(auth: KimiWebAuthContext): Record<string, string> {
  return {
    ...buildBaseHeaders(auth),
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

export function buildKimiWebChatHeaders(auth: KimiWebAuthContext): Record<string, string> {
  return {
    ...buildBaseHeaders(auth),
    Accept: "*/*",
    "Content-Type": "application/connect+json",
    "Connect-Protocol-Version": "1",
  };
}

export function encodeKimiConnectFrame(payload: unknown): Uint8Array {
  const json = Buffer.from(JSON.stringify(payload), "utf8");
  const framed = new Uint8Array(new ArrayBuffer(5 + json.byteLength));
  framed[0] = 0x00;
  new DataView(framed.buffer).setUint32(1, json.byteLength, false);
  framed.set(json, 5);
  return framed;
}

function concatUint8Arrays(left: Uint8Array, right: Uint8Array): Uint8Array {
  const combined = new Uint8Array(new ArrayBuffer(left.byteLength + right.byteLength));
  combined.set(left, 0);
  combined.set(right, left.byteLength);
  return combined;
}

export function* decodeKimiConnectFrames(buffer: Uint8Array): Generator<KimiConnectFrame> {
  let offset = 0;
  while (offset + 5 <= buffer.byteLength) {
    const flag = buffer[offset];
    const length = new DataView(buffer.buffer, buffer.byteOffset + offset + 1, 4).getUint32(0, false);
    const frameEnd = offset + 5 + length;
    if (frameEnd > buffer.byteLength) break;

    const payload = buffer.slice(offset + 5, frameEnd);
    const rawText = Buffer.from(payload).toString("utf8").trim();
    let event: JsonRecord | null = null;
    if (rawText.length > 0) {
      try {
        const parsed = JSON.parse(rawText) as unknown;
        event = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as JsonRecord) : null;
      } catch {
        event = null;
      }
    }

    yield { flag, event, rawText };
    offset = frameEnd;
  }
}

export async function* decodeKimiConnectEventStream(
  body: ReadableStream<Uint8Array> | null | undefined
): AsyncGenerator<KimiConnectFrame> {
  const reader = body?.getReader();
  if (!reader) return;

  let buffer: Uint8Array = new Uint8Array(0);

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value || value.byteLength === 0) continue;

    buffer = concatUint8Arrays(buffer, value);
    let consumed = 0;

    while (consumed + 5 <= buffer.byteLength) {
      const length = new DataView(buffer.buffer, buffer.byteOffset + consumed + 1, 4).getUint32(0, false);
      const frameEnd = consumed + 5 + length;
      if (frameEnd > buffer.byteLength) break;

      const frameBytes = buffer.slice(consumed, frameEnd);
      for (const frame of decodeKimiConnectFrames(frameBytes)) {
        yield frame;
      }
      consumed = frameEnd;
    }

    if (consumed > 0) {
      buffer = buffer.slice(consumed);
    }
  }
}

function getKimiModelVersion(displayName: string, scenario: string): string {
  const match = displayName.match(/\bK\s*([0-9]+(?:\.[0-9]+)?)\b/i);
  if (match) return `k${match[1]}`;
  if (scenario === "SCENARIO_K2D5") return "k2.6";
  if (scenario === "SCENARIO_K2") return "k2";
  return scenario.toLowerCase().replace(/^scenario_/, "").replace(/_/g, "-");
}

function getKimiModelSuffix({
  scenario,
  displayName,
  thinking,
  kimiPlusId,
  agentMode,
}: {
  scenario: string;
  displayName: string;
  thinking: boolean;
  kimiPlusId: string;
  agentMode: string;
}): string {
  const loweredName = displayName.toLowerCase();
  if (agentMode === "TYPE_ULTRA" || loweredName.includes("swarm")) return "agent-swarm";
  if (scenario === "SCENARIO_OK_COMPUTER" || kimiPlusId || loweredName.includes("agent")) {
    return "agent";
  }
  if (thinking) return "thinking";
  return "";
}

function buildKimiWebModelId(rawModel: JsonRecord): string {
  const scenario = toNonEmptyString(rawModel.scenario) || "SCENARIO_K2D5";
  const displayName = toNonEmptyString(rawModel.displayName) || toNonEmptyString(rawModel.display_name) || scenario;
  const thinking = rawModel.thinking === true;
  const kimiPlusId = toNonEmptyString(rawModel.kimiPlusId) || toNonEmptyString(rawModel.kimi_plus_id) || "";
  const agentMode = toNonEmptyString(rawModel.agentMode) || toNonEmptyString(rawModel.agent_mode) || "";
  const version = getKimiModelVersion(displayName, scenario);
  const suffix = getKimiModelSuffix({ scenario, displayName, thinking, kimiPlusId, agentMode });
  return `kimi-${version}${suffix ? `-${suffix}` : ""}`;
}

export function normalizeKimiWebCatalog(data: unknown): KimiWebCatalogModel[] {
  const payload = asRecord(data);
  const items = Array.isArray(payload.availableModels)
    ? payload.availableModels
    : Array.isArray(payload.available_models)
      ? payload.available_models
      : [];

  const deduped = new Map<string, KimiWebCatalogModel>();
  for (const item of items) {
    const record = asRecord(item);
    const id = buildKimiWebModelId(record);
    if (!id) continue;

    const name =
      toNonEmptyString(record.displayName) || toNonEmptyString(record.display_name) || id;
    deduped.set(id, {
      id,
      name,
      scenario: toNonEmptyString(record.scenario) || "SCENARIO_K2D5",
      thinking: record.thinking === true,
      ...(record.thinking === true ? { supportsThinking: true } : {}),
      ...(toNonEmptyString(record.description)
        ? { description: toNonEmptyString(record.description)! }
        : {}),
      ...(toNonEmptyString(record.inputPlaceholder) || toNonEmptyString(record.input_placeholder)
        ? {
            inputPlaceholder:
              toNonEmptyString(record.inputPlaceholder) ||
              toNonEmptyString(record.input_placeholder) ||
              undefined,
          }
        : {}),
      ...(toNonEmptyString(record.kimiPlusId) || toNonEmptyString(record.kimi_plus_id)
        ? {
            kimiPlusId:
              toNonEmptyString(record.kimiPlusId) ||
              toNonEmptyString(record.kimi_plus_id) ||
              undefined,
          }
        : {}),
      ...(toNonEmptyString(record.agentMode) || toNonEmptyString(record.agent_mode)
        ? {
            agentMode:
              toNonEmptyString(record.agentMode) ||
              toNonEmptyString(record.agent_mode) ||
              undefined,
          }
        : {}),
      ...(toNonEmptyString(record.key) ? { rawKey: toNonEmptyString(record.key)! } : {}),
    });
  }

  return Array.from(deduped.values());
}

export function resolveKimiWebModel(modelId: string | null | undefined): KimiWebResolvedModel {
  const raw = toNonEmptyString(modelId)?.toLowerCase() || "kimi-k2.6";
  const aliased = LEGACY_MODEL_ALIASES[raw] || raw;
  const useSearch = aliased.endsWith("-search");
  const withoutSearch = useSearch ? aliased.slice(0, -7) : aliased;

  if (withoutSearch.endsWith("-agent-swarm")) {
    return {
      id: withoutSearch,
      name: "K2.6 Agent Swarm",
      scenario: "SCENARIO_OK_COMPUTER",
      thinking: false,
      useSearch: false,
      kimiPlusId: "ok-computer",
      agentMode: "TYPE_ULTRA",
    };
  }

  if (withoutSearch.endsWith("-agent")) {
    return {
      id: withoutSearch,
      name: "K2.6 Agent",
      scenario: "SCENARIO_OK_COMPUTER",
      thinking: false,
      useSearch: false,
      kimiPlusId: "ok-computer",
      agentMode: "TYPE_NORMAL",
    };
  }

  const thinking = withoutSearch.endsWith("-thinking");
  const baseId = thinking ? withoutSearch.slice(0, -9) : withoutSearch;

  if (baseId === "kimi-k2") {
    return {
      id: withoutSearch,
      name: thinking ? "K2 Thinking" : "K2 Instant",
      scenario: "SCENARIO_K2",
      thinking,
      useSearch,
    };
  }

  return {
    id: withoutSearch,
    name: thinking ? "K2.6 Thinking" : "K2.6 Instant",
    scenario: "SCENARIO_K2D5",
    thinking,
    useSearch,
  };
}

function extractExplicitPhase(event: JsonRecord): KimiWebPhase {
  const block = asRecord(event.block);
  const multiStage = asRecord(block.multiStage);
  const stages = Array.isArray(multiStage.stages) ? multiStage.stages : [];
  if (stages.length > 0) {
    const firstStage = asRecord(stages[0]);
    if (firstStage.name === THINKING_STAGE_NAME) {
      return firstStage.status === "completed" ? "answer" : "thinking";
    }
  }

  const flags = toNonEmptyString(asRecord(block.text).flags);
  if (flags === "thinking") return "thinking";
  if (flags === "answer") return "answer";
  return null;
}

export function extractKimiWebEventDelta(
  event: JsonRecord,
  currentPhase: KimiWebPhase = null
): {
  phase: KimiWebPhase;
  content?: string;
  reasoningContent?: string;
  done?: boolean;
  error?: string;
} {
  if (event.done) {
    return { phase: currentPhase, done: true };
  }

  const eventError = asRecord(event.error);
  const errorMessage =
    toNonEmptyString(eventError.message) ||
    (typeof event.error === "string" ? event.error : null);
  if (errorMessage) {
    return { phase: currentPhase, error: errorMessage };
  }

  if (event.heartbeat) {
    return { phase: currentPhase };
  }

  const explicitPhase = extractExplicitPhase(event);
  const phase = explicitPhase || currentPhase;
  const block = asRecord(event.block);
  const think = asRecord(block.think);
  const text = asRecord(block.text);
  const mask = toNonEmptyString(event.mask) || "";

  const thinkContent = toRawNonEmptyString(think.content);
  if (thinkContent) {
    return {
      phase: phase || "thinking",
      reasoningContent: thinkContent,
    };
  }

  const textContent = toRawNonEmptyString(text.content);
  if (textContent) {
    if (explicitPhase === "thinking" || mask.includes("block.think")) {
      return {
        phase: phase || "thinking",
        reasoningContent: textContent,
      };
    }

    return {
      phase: phase || "answer",
      content: textContent,
    };
  }

  return { phase };
}
