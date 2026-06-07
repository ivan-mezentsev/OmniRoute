import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-gemini-web-models-"));
process.env.DATA_DIR = TEST_DATA_DIR;

const core = await import("../../src/lib/db/core.ts");
const providersDb = await import("../../src/lib/db/providers.ts");
const providerModelsRoute = await import("../../src/app/api/providers/[id]/models/route.ts");

const originalFetch = globalThis.fetch;

async function resetStorage() {
  globalThis.fetch = originalFetch;
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
}

async function seedGeminiWebConnection(cookie: string) {
  return providersDb.createProviderConnection({
    provider: "gemini-web",
    authType: "apikey",
    name: `gemini-web-${Math.random().toString(16).slice(2, 8)}`,
    apiKey: cookie,
    accessToken: null,
    projectId: null,
    isActive: true,
    testStatus: "active",
    providerSpecificData: {},
  });
}

async function callRoute(connectionId: string, search = "") {
  return providerModelsRoute.GET(
    new Request(`http://localhost/api/providers/${connectionId}/models${search}`),
    { params: { id: connectionId } }
  );
}

test.beforeEach(async () => {
  await resetStorage();
});

test.after(async () => {
  globalThis.fetch = originalFetch;
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

test("gemini-web models route discovers models through the GetUserStatus batchexecute RPC", async () => {
  const connection = await seedGeminiWebConnection(
    "__Secure-1PSID=gem-web-cookie; __Secure-1PSIDTS=gem-web-ts"
  );
  assert.ok(connection && typeof connection.id === "string");

  globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => {
    const urlString = String(url);
    const headers = init?.headers as Record<string, string> | undefined;

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

    assert.match(urlString, /https:\/\/gemini\.google\.com\/_\/BardChatUi\/data\/batchexecute\?/);
    assert.equal(init?.method, "POST");
    assert.equal(headers?.["X-Same-Domain"], "1");
    assert.equal(
      headers?.Cookie,
      "__Secure-1PSID=gem-web-cookie; __Secure-1PSIDTS=gem-web-ts"
    );

    const formBody = String(init?.body || "");
    assert.match(formBody, /at=token_123/);
    assert.match(decodeURIComponent(formBody), /otAQ7b/);

    const userStatus: unknown[] = [];
    userStatus[14] = 1000;
    userStatus[15] = [
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
    ];

    const frame = JSON.stringify([
      ["wrb.fr", "otAQ7b", JSON.stringify(userStatus), null, null, [0]],
    ]);
    const responseText = `)]}'\n${frame.length + 1}\n${frame}`;

    return new Response(responseText, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  };

  const response = await callRoute(connection.id);
  const body = (await response.json()) as {
    source: string;
    models: Array<{
      id: string;
      name: string;
      description?: string;
      supportsThinking?: boolean;
    }>;
  };

  assert.equal(response.status, 200);
  assert.equal(body.source, "api");
  assert.deepEqual(body.models, [
    {
      id: "gemini-3.5-flash",
      name: "Gemini 3.5 Flash",
      description: "Fast general model",
    },
    {
      id: "gemini-3.5-flash-thinking",
      name: "Gemini 3.5 Flash Thinking",
      description: "Reasoning variant",
      supportsThinking: true,
    },
  ]);
});
