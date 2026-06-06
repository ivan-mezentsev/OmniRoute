import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeKimiWebCatalog,
  parseKimiWebAuth,
  resolveKimiWebModel,
} from "../../open-sse/services/kimiWeb.ts";

const TEST_TOKEN = [
  "header",
  Buffer.from(
    JSON.stringify({
      app_id: "kimi",
      typ: "access",
      device_id: "7000000000000000001",
      ssid: "1700000000000000001",
    })
  ).toString("base64url"),
  "signature",
].join(".");

test("parseKimiWebAuth extracts kimi-auth token and JWT metadata from a multiline cookie export", () => {
  const auth = parseKimiWebAuth([
    "theme dark",
    `kimi-auth ${TEST_TOKEN}`,
    "__snaker__id abc123",
  ].join("\n"));

  assert.equal(auth.token, TEST_TOKEN);
  assert.equal(auth.deviceId, "7000000000000000001");
  assert.equal(auth.sessionId, "1700000000000000001");
  assert.ok(auth.cookieHeader?.includes(`kimi-auth=${TEST_TOKEN}`));
  assert.ok(auth.cookieHeader?.includes("theme=dark"));
});

test("normalizeKimiWebCatalog maps live GetAvailableModels payload to semantic ids", () => {
  const catalog = normalizeKimiWebCatalog({
    availableModels: [
      {
        scenario: "SCENARIO_K2D5",
        displayName: "K2.6 Instant",
        description: "Quick response",
        inputPlaceholder: "Ask away. Pics work too.",
        key: "k2d6",
      },
      {
        scenario: "SCENARIO_K2D5",
        displayName: "K2.6 Thinking",
        description: "Deep thinking for complex questions",
        thinking: true,
        key: "k2d6-thinking",
      },
      {
        scenario: "SCENARIO_OK_COMPUTER",
        displayName: "K2.6 Agent",
        description: "Research, slides, websites, docs, sheets",
        kimiPlusId: "ok-computer",
        agentMode: "TYPE_NORMAL",
        key: "k2d6-agent",
      },
      {
        scenario: "SCENARIO_OK_COMPUTER",
        displayName: "K2.6 Agent Swarm",
        description: "Large-scale search, long-form writing, batch tasks",
        kimiPlusId: "ok-computer",
        agentMode: "TYPE_ULTRA",
        key: "k2d6-agent-ultra",
      },
    ],
  });

  assert.deepEqual(
    catalog.map((model) => ({
      id: model.id,
      name: model.name,
      supportsThinking: model.supportsThinking === true,
    })),
    [
      { id: "kimi-k2.6", name: "K2.6 Instant", supportsThinking: false },
      { id: "kimi-k2.6-thinking", name: "K2.6 Thinking", supportsThinking: true },
      { id: "kimi-k2.6-agent", name: "K2.6 Agent", supportsThinking: false },
      { id: "kimi-k2.6-agent-swarm", name: "K2.6 Agent Swarm", supportsThinking: false },
    ]
  );
});

test("resolveKimiWebModel supports semantic ids, raw catalog keys, and legacy ids", () => {
  assert.deepEqual(resolveKimiWebModel("kimi-k2.6"), {
    id: "kimi-k2.6",
    name: "K2.6 Instant",
    scenario: "SCENARIO_K2D5",
    thinking: false,
    useSearch: false,
  });

  assert.deepEqual(resolveKimiWebModel("kimi-k2.6-thinking"), {
    id: "kimi-k2.6-thinking",
    name: "K2.6 Thinking",
    scenario: "SCENARIO_K2D5",
    thinking: true,
    useSearch: false,
  });

  assert.deepEqual(resolveKimiWebModel("k2d6-agent"), {
    id: "kimi-k2.6-agent",
    name: "K2.6 Agent",
    scenario: "SCENARIO_OK_COMPUTER",
    thinking: false,
    useSearch: false,
    kimiPlusId: "ok-computer",
    agentMode: "TYPE_NORMAL",
  });

  assert.deepEqual(resolveKimiWebModel("kimi-default"), {
    id: "kimi-k2.6",
    name: "K2.6 Instant",
    scenario: "SCENARIO_K2D5",
    thinking: false,
    useSearch: false,
  });
});
