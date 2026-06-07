export type TopologyMetricSummary = {
  lastRequestAt?: string | null;
  lastErrorAt?: string | null;
};

export const TOPOLOGY_RECENT_TIMEOUT_MS = 15_000;
export const TOPOLOGY_ERROR_TIMEOUT_MS = 60_000;

export function resolveTopologyRecency(
  providerMetrics: Record<string, TopologyMetricSummary>,
  normalizeProviderId: (providerId?: string | null) => string,
  {
    now = Date.now(),
    recentTimeoutMs = TOPOLOGY_RECENT_TIMEOUT_MS,
    errorTimeoutMs = TOPOLOGY_ERROR_TIMEOUT_MS,
  }: {
    now?: number;
    recentTimeoutMs?: number;
    errorTimeoutMs?: number;
  } = {}
) {
  let lastProvider = "";
  let lastProviderTs = 0;
  let errorProvider = "";
  let errorProviderTs = 0;

  for (const [provider, metrics] of Object.entries(providerMetrics)) {
    const requestTs = metrics.lastRequestAt ? Date.parse(metrics.lastRequestAt) : 0;
    if (
      Number.isFinite(requestTs) &&
      requestTs > lastProviderTs &&
      now - requestTs <= recentTimeoutMs
    ) {
      lastProvider = normalizeProviderId(provider);
      lastProviderTs = requestTs;
    }

    const errorTs = metrics.lastErrorAt ? Date.parse(metrics.lastErrorAt) : 0;
    if (Number.isFinite(errorTs) && errorTs > errorProviderTs && now - errorTs <= errorTimeoutMs) {
      errorProvider = normalizeProviderId(provider);
      errorProviderTs = errorTs;
    }
  }

  return { lastProvider, errorProvider };
}
