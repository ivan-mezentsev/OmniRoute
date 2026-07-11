import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCompatibleModelsEnvelope,
  isCodexModelCatalogClient,
} from "../../src/app/api/v1/models/catalogRequest.ts";

const data = [
  { id: "gpt-5.6-sol", object: "model", owned_by: "codex" },
  { id: "cx/gpt-5.6-sol", object: "model", owned_by: "codex" },
];

test("buildCompatibleModelsEnvelope preserves the standard OpenAI response by default", () => {
  assert.deepEqual(buildCompatibleModelsEnvelope(data), { object: "list", data });
});

test("buildCompatibleModelsEnvelope adds an empty Codex catalog for Codex Desktop / CLI requests", () => {
  const request = new Request("https://router.example/v1/models?client_version=0.144.0", {
    headers: { "User-Agent": "Codex Desktop/0.144.0-alpha.4" },
  });

  assert.deepEqual(buildCompatibleModelsEnvelope(data, request), {
    object: "list",
    data,
    models: [],
  });
});

test("isCodexModelCatalogClient only detects Codex user agents when client_version is present", () => {
  const cases: Array<[string, boolean]> = [
    ["Codex Desktop/0.144.0-alpha.4", true],
    ["codex_cli_rs/0.144.1", true],
    ["codex_exec/0.144.1", true],
    ["openai-node/6.0.0", false],
  ];

  for (const [userAgent, expected] of cases) {
    const request = new Request("https://router.example/v1/models?client_version=0.144.0", {
      headers: { "User-Agent": userAgent },
    });
    assert.equal(isCodexModelCatalogClient(request), expected, userAgent);
  }
});

test("isCodexModelCatalogClient ignores Codex-looking agents without the version query", () => {
  const request = new Request("https://router.example/v1/models", {
    headers: { "User-Agent": "Codex Desktop/0.144.0-alpha.4" },
  });

  assert.equal(isCodexModelCatalogClient(request), false);
});
