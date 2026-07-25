import test from "node:test";
import assert from "node:assert/strict";

import { getModelsByProviderId } from "../../open-sse/config/providerModels.ts";
import { resolveCanonicalProviderModel } from "../../open-sse/services/model.ts";
import { DEFAULT_PRICING } from "../../src/shared/constants/pricing.ts";
import { getStaticModelsForProvider } from "../../src/lib/providers/staticModels.ts";

test("Pollinations catalog mirrors the current public text model lineup", () => {
  const models = getModelsByProviderId("pollinations");
  const ids = new Set(models.map((model) => model.id));
  const names = models.map((model) => model.name);

  assert.ok(ids.has("openai-fast"));
  assert.ok(ids.has("openai-large"));
  assert.ok(ids.has("perplexity-fast"));
  assert.ok(ids.has("qwen-coder-large"));
  assert.ok(ids.has("claude-large"));
  assert.equal(ids.has("llama"), false);
  assert.equal(
    names.some((name) => /GPT-5 via Pollinations/i.test(name)),
    false
  );
});

test("Puter catalog exposes the currently documented Sonar models", () => {
  const ids = new Set(getModelsByProviderId("puter").map((model) => model.id));

  assert.ok(ids.has("perplexity/sonar"));
  assert.ok(ids.has("perplexity/sonar-pro"));
  assert.ok(ids.has("perplexity/sonar-pro-search"));
  assert.ok(ids.has("perplexity/sonar-reasoning-pro"));
  assert.ok(ids.has("perplexity/sonar-deep-research"));
});

test("NVIDIA catalog includes the verified 2026 additions and GPT OSS 20B alias resolution", () => {
  const ids = new Set(getModelsByProviderId("nvidia").map((model) => model.id));

  assert.ok(ids.has("openai/gpt-oss-20b"));
  assert.ok(ids.has("nvidia/nemotron-3-super-120b-a12b"));
  assert.ok(ids.has("mistralai/mistral-large-3-675b-instruct-2512"));
  assert.ok(ids.has("qwen/qwen3.5-397b-a17b"));
  assert.ok(ids.has("mistralai/devstral-2-123b-instruct-2512"));

  assert.deepEqual(resolveCanonicalProviderModel("nvidia", "gpt-oss-20b"), {
    provider: "nvidia",
    model: "openai/gpt-oss-20b",
  });
});

test("Fable 5 catalog exposes claude-fable-5 in cc with matching pricing", () => {
  const ccModels = getModelsByProviderId("cc");
  const fable = ccModels.find((model) => model.id === "claude-fable-5");

  assert.ok(fable, "cc must expose claude-fable-5");
  assert.equal(fable.contextLength, 1000000);
  assert.equal(fable.maxOutputTokens, 128000);

  const pricing = DEFAULT_PRICING as Record<string, Record<string, unknown>>;
  assert.ok(pricing.cc["claude-fable-5"], "cc pricing must include claude-fable-5");
  assert.ok(pricing.kiro["claude-fable-5"], "kiro pricing must include claude-fable-5");
});

test("Opus 5 catalog is limited to verified first-party, web, and Copilot providers", () => {
  for (const providerId of ["claude", "github", "claude-web", "anthropic"]) {
    const model = getModelsByProviderId(providerId).find((entry) => entry.id === "claude-opus-5");
    assert.ok(model, `${providerId} must expose claude-opus-5`);
  }

  const claude = getModelsByProviderId("claude").find((entry) => entry.id === "claude-opus-5");
  assert.equal(claude?.contextLength, 1000000);
  assert.equal(claude?.maxOutputTokens, 128000);
  assert.ok(
    getStaticModelsForProvider("claude")?.some((entry) => entry.id === "claude-opus-5"),
    "claude OAuth discovery must expose claude-opus-5"
  );

  const github = getModelsByProviderId("github").find((entry) => entry.id === "claude-opus-5");
  assert.equal(github?.targetFormat, "claude");

  const kiroIds = new Set(getModelsByProviderId("kiro").map((entry) => entry.id));
  assert.equal(kiroIds.has("claude-opus-5"), false, "do not fabricate Kiro availability");

  const pricing = DEFAULT_PRICING as Record<string, Record<string, unknown>>;
  for (const providerId of ["cc", "gh", "anthropic"]) {
    const price = pricing[providerId]["claude-opus-5"] as { input: number; output: number };
    assert.equal(price.input, 5.0, `${providerId} Opus 5 input price`);
    assert.equal(price.output, 25.0, `${providerId} Opus 5 output price`);
  }
});
