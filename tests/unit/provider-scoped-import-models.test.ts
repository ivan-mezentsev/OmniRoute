import test from "node:test";
import assert from "node:assert/strict";

import { filterProviderScopedImportModels } from "../../src/lib/providerModels/providerScopedImport";

test("filterProviderScopedImportModels only compares against the current provider scope", () => {
  const fetchedModels = [
    { id: "gemini-3.5-flash", name: "Gemini 3.5 Flash" },
    { id: "gemini-3.5-thinking", name: "Gemini 3.5 Thinking" },
    { id: "gemini-3.1-pro", name: "Gemini 3.1 Pro" },
  ];

  const registryModelsForCurrentProvider = [
    { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
    { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
  ];

  const syncedAvailableModelsForCurrentProvider = [];
  const customModelsForCurrentProvider = [];

  const result = filterProviderScopedImportModels({
    fetchedModels,
    registryModels: registryModelsForCurrentProvider,
    syncedAvailableModels: syncedAvailableModelsForCurrentProvider,
    customModels: customModelsForCurrentProvider,
  });

  assert.deepEqual(result, fetchedModels);
});

test("filterProviderScopedImportModels skips models already present for the same provider", () => {
  const fetchedModels = [
    { id: "gemini-3.5-flash", name: "Gemini 3.5 Flash" },
    { id: "gemini-3.5-thinking", name: "Gemini 3.5 Thinking" },
  ];

  const result = filterProviderScopedImportModels({
    fetchedModels,
    registryModels: [{ id: "gemini-3.5-flash", name: "Gemini 3.5 Flash" }],
    syncedAvailableModels: [],
    customModels: [{ id: "gemini-3.5-thinking", name: "Gemini 3.5 Thinking" }],
  });

  assert.deepEqual(result, []);
});
