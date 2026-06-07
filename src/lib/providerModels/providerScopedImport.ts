type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function toNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function getModelId(model: unknown): string | null {
  const record = asRecord(model);
  return (
    toNonEmptyString(record.id) ||
    toNonEmptyString(record.name) ||
    toNonEmptyString(record.model)
  );
}

export function filterProviderScopedImportModels({
  fetchedModels,
  registryModels = [],
  syncedAvailableModels = [],
  customModels = [],
}: {
  fetchedModels: unknown;
  registryModels?: unknown;
  syncedAvailableModels?: unknown;
  customModels?: unknown;
}) {
  const fetchedList = Array.isArray(fetchedModels) ? fetchedModels : [];
  const registryList = Array.isArray(registryModels) ? registryModels : [];
  const syncedList = Array.isArray(syncedAvailableModels) ? syncedAvailableModels : [];
  const customList = Array.isArray(customModels) ? customModels : [];

  const existingIds = new Set(
    [...registryList, ...syncedList, ...customList]
      .map((model) => getModelId(model))
      .filter((modelId): modelId is string => Boolean(modelId))
  );

  return fetchedList.filter((model) => {
    const modelId = getModelId(model);
    return modelId && !existingIds.has(modelId);
  });
}
