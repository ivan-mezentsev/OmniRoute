import test from "node:test";
import assert from "node:assert/strict";

const { GeminiWebExecutor } = await import("../../open-sse/executors/gemini-web.ts");
const { getExecutor, hasSpecializedExecutor } = await import("../../open-sse/executors/index.ts");

const originalFetch = globalThis.fetch;

type ExecutorErrorJson = {
  error: {
    message: string;
  };
};

type ChatCompletionJson = {
  model: string;
  choices: Array<{
    message: {
      content: string;
    };
  }>;
};

type RegistryModel = {
  id: string;
};

function buildGeminiGetUserStatusResponse(models: unknown[]) {
  const userStatus: unknown[] = [];
  userStatus[14] = 1000;
  userStatus[15] = models;
  const frame = JSON.stringify([["wrb.fr", "otAQ7b", JSON.stringify(userStatus), null, null, [0]]]);
  return `)]}'\n${frame.length + 1}\n${frame}`;
}

function buildGeminiStreamResponse(text: string) {
  const payload: unknown[] = [];
  payload[4] = [["response-candidate", [text]]];
  payload[25] = "conversation-context";
  const frame = JSON.stringify([["wrb.fr", null, JSON.stringify(payload)]]);
  return `)]}'\n${frame.length + 1}\n${frame}`;
}

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ─── Registration ───────────────────────────────────────────────────────────

test("GeminiWebExecutor is registered in executor index", () => {
  assert.ok(hasSpecializedExecutor("gemini-web"));
  const executor = getExecutor("gemini-web");
  assert.ok(executor instanceof GeminiWebExecutor);
});

test("GeminiWebExecutor sets correct provider name", () => {
  const executor = new GeminiWebExecutor();
  assert.equal(executor.getProvider(), "gemini-web");
});

// ─── Input validation ───────────────────────────────────────────────────────

test("Returns 401 when no cookies provided", async () => {
  const executor = new GeminiWebExecutor();
  const result = await executor.execute({
    model: "gemini-2.5-pro",
    body: { messages: [{ role: "user", content: "hi" }], stream: false },
    stream: false,
    credentials: {},
    signal: AbortSignal.timeout(10000),
    log: null,
  });
  assert.equal(result.response.status, 401);
  const json = (await result.response.json()) as ExecutorErrorJson;
  assert.match(json.error.message, /Gemini Web requires __Secure-1PSID cookies/i);
});

test("Returns 400 when no user message", async () => {
  const executor = new GeminiWebExecutor();
  const result = await executor.execute({
    model: "gemini-2.5-pro",
    body: { messages: [{ role: "system", content: "You are helpful" }], stream: false },
    stream: false,
    credentials: { apiKey: "test-cookie" },
    signal: AbortSignal.timeout(10000),
    log: null,
  });
  assert.equal(result.response.status, 400);
  const json = (await result.response.json()) as ExecutorErrorJson;
  assert.match(json.error.message, /No user message/i);
});

test("Returns a descriptive bootstrap error when Gemini app HTML has no bootstrap tokens", async () => {
  const executor = new GeminiWebExecutor();

  globalThis.fetch = async (url: string | URL | Request) => {
    assert.equal(String(url), "https://gemini.google.com/app");
    return new Response("<html><body>Sign in to continue to Gemini</body></html>", {
      status: 200,
      headers: { "Content-Type": "text/html" },
    });
  };

  const result = await executor.execute({
    model: "gemini-3.5-flash",
    body: { messages: [{ role: "user", content: "hi" }], stream: false },
    stream: false,
    credentials: { apiKey: "__Secure-1PSID=gem-web-cookie; __Secure-1PSIDTS=gem-web-ts" },
    signal: AbortSignal.timeout(10000),
    log: null,
  });

  assert.equal(result.response.status, 401);
  const json = (await result.response.json()) as ExecutorErrorJson;
  assert.match(json.error.message, /bootstrap tokens/i);
  assert.doesNotMatch(json.error.message, /Cannot read properties of null/i);
});

test("GeminiWebExecutor sends prompts through bootstrap, GetUserStatus, and StreamGenerate", async () => {
  const executor = new GeminiWebExecutor();
  const calls: string[] = [];

  globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => {
    const urlString = String(url);
    const headers = init?.headers as Record<string, string> | undefined;
    calls.push(urlString);

    if (urlString === "https://gemini.google.com/app") {
      assert.equal(init?.method, "GET");
      assert.equal(
        headers?.Cookie,
        "__Secure-1PSID=gem-web-cookie; __Secure-1PSIDTS=gem-web-ts"
      );
      return new Response(
        '<html><script>var data={"SNlM0e":"token_123","cfb2h":"build-label","FdrFJe":"session-id","TuX5cc":"en"};</script></html>',
        { status: 200, headers: { "Content-Type": "text/html" } }
      );
    }

    if (urlString.includes("/data/batchexecute?")) {
      assert.equal(init?.method, "POST");
      assert.equal(headers?.["X-Same-Domain"], "1");
      assert.match(String(init?.body || ""), /at=token_123/);
      return new Response(
        buildGeminiGetUserStatusResponse([
          [
            "56fdd199312815e2",
            "Gemini 3.5 Flash",
            "Fast general model",
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            "3.5-flash",
            null,
            null,
            null,
            null,
            null,
            null,
            1,
            null,
            "3.5-flash",
          ],
          [
            "e051ce1aa80aa576",
            "Gemini 3.5 Flash Thinking",
            "Reasoning variant",
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            "3.5-flash-thinking",
            null,
            null,
            null,
            null,
            null,
            null,
            2,
            null,
            "3.5-flash-thinking",
          ],
        ]),
        { status: 200, headers: { "Content-Type": "text/plain" } }
      );
    }

    assert.match(
      urlString,
      /https:\/\/gemini\.google\.com\/_\/BardChatUi\/data\/assistant\.lamda\.BardFrontendService\/StreamGenerate\?/
    );
    assert.equal(init?.method, "POST");
    assert.equal(headers?.Cookie, "__Secure-1PSID=gem-web-cookie; __Secure-1PSIDTS=gem-web-ts");
    assert.match(headers?.["x-goog-ext-525001261-jspb"] || "", /e051ce1aa80aa576/);
    assert.ok(headers?.["x-goog-ext-525005358-jspb"]);
    const body = decodeURIComponent(String(init?.body || "")).replace(/\+/g, " ");
    assert.match(body, /at=token_123/);
    assert.match(body, /What is new\?/);
    return new Response(buildGeminiStreamResponse("Fresh Gemini answer"), {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  };

  const result = await executor.execute({
    model: "gemini-3.5-flash-thinking",
    body: {
      model: "gemini-3.5-flash-thinking",
      messages: [{ role: "user", content: "What is new?" }],
      stream: false,
    },
    stream: false,
    credentials: { apiKey: "__Secure-1PSID=gem-web-cookie; __Secure-1PSIDTS=gem-web-ts" },
    signal: AbortSignal.timeout(10000),
    log: null,
  });

  assert.equal(result.response.status, 200);
  assert.equal(calls.length, 3);
  const json = (await result.response.json()) as ChatCompletionJson;
  assert.equal(json.model, "gemini-3.5-flash-thinking");
  assert.equal(json.choices[0].message.content, "Fresh Gemini answer");
});

// ─── Provider registration ──────────────────────────────────────────────────

test("Provider: gemini-web in WEB_COOKIE_PROVIDERS", async () => {
  const { WEB_COOKIE_PROVIDERS } = await import("../../src/shared/constants/providers.ts");
  assert.ok(WEB_COOKIE_PROVIDERS["gemini-web"], "gemini-web should be in WEB_COOKIE_PROVIDERS");
  assert.equal(WEB_COOKIE_PROVIDERS["gemini-web"].id, "gemini-web");
  assert.ok(WEB_COOKIE_PROVIDERS["gemini-web"].authHint);
});

test("Provider: gemini-web in providerRegistry", async () => {
  const { REGISTRY } = await import("../../open-sse/config/providerRegistry.ts");
  assert.ok(REGISTRY["gemini-web"], "gemini-web should be in providerRegistry");
  assert.equal(REGISTRY["gemini-web"].executor, "gemini-web");
  assert.ok(REGISTRY["gemini-web"].models.length > 0);
});

test("Provider: gemini-web has correct models", async () => {
  const { REGISTRY } = await import("../../open-sse/config/providerRegistry.ts");
  const models = REGISTRY["gemini-web"].models;
  const modelIds = models.map((model) => (model as RegistryModel).id);
  assert.ok(modelIds.includes("gemini-2.5-pro"));
  assert.ok(modelIds.includes("gemini-2.5-flash"));
  assert.ok(modelIds.includes("gemini-2.0-pro"));
  assert.ok(modelIds.includes("gemini-2.0-flash"));
});
