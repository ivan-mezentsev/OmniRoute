const CODEX_MODEL_CATALOG_USER_AGENT = /\bcodex(?:[_ -](?:desktop|cli_rs|cli|exec))?\b/i;

/**
 * Detect Codex Desktop / CLI catalog refresh requests.
 *
 * Codex clients call `/v1/models?client_version=...` but expect a Codex-specific
 * envelope that includes a `models` field in addition to the standard OpenAI
 * `data` array. We intentionally return `models: []` so Codex can keep using
 * its bundled version-matched catalog while still accepting OmniRoute's list
 * response shape.
 */
export function isCodexModelCatalogClient(request: Request | null | undefined): boolean {
  if (!request?.url || typeof request.headers?.get !== "function") return false;

  const clientVersion = new URL(request.url).searchParams.get("client_version");
  if (!clientVersion) return false;

  const userAgent = request.headers.get("user-agent") || "";
  return CODEX_MODEL_CATALOG_USER_AGENT.test(userAgent);
}

export function buildCompatibleModelsEnvelope(
  data: unknown[],
  request?: Request | null
): { object: "list"; data: unknown[]; models?: unknown[] } {
  const response: { object: "list"; data: unknown[]; models?: unknown[] } = {
    object: "list",
    data,
  };

  if (isCodexModelCatalogClient(request)) {
    response.models = [];
  }

  return response;
}
