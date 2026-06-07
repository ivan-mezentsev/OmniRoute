import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveTopologyRecency,
  TOPOLOGY_ERROR_TIMEOUT_MS,
  TOPOLOGY_RECENT_TIMEOUT_MS,
} from "../../src/app/(dashboard)/home/topologyRecency";

const normalize = (providerId?: string | null) =>
  typeof providerId === "string" ? providerId.trim().toLowerCase() : "";

test("resolveTopologyRecency keeps the newest recent provider only within the recent timeout", () => {
  const now = Date.parse("2026-06-07T10:00:00.000Z");
  const providerMetrics = {
    codex: {
      lastRequestAt: new Date(now - 5_000).toISOString(),
    },
    claude: {
      lastRequestAt: new Date(now - 20_000).toISOString(),
    },
  };

  assert.deepEqual(resolveTopologyRecency(providerMetrics, normalize, { now }), {
    lastProvider: "codex",
    errorProvider: "",
  });

  assert.deepEqual(
    resolveTopologyRecency(providerMetrics, normalize, {
      now: now + TOPOLOGY_RECENT_TIMEOUT_MS + 1,
    }),
    {
      lastProvider: "",
      errorProvider: "",
    }
  );
});

test("resolveTopologyRecency keeps recent errors visible longer, then fades them too", () => {
  const now = Date.parse("2026-06-07T10:00:00.000Z");
  const providerMetrics = {
    kimi: {
      lastErrorAt: new Date(now - 10_000).toISOString(),
    },
  };

  assert.deepEqual(resolveTopologyRecency(providerMetrics, normalize, { now }), {
    lastProvider: "",
    errorProvider: "kimi",
  });

  assert.deepEqual(
    resolveTopologyRecency(providerMetrics, normalize, {
      now: now + TOPOLOGY_ERROR_TIMEOUT_MS + 1,
    }),
    {
      lastProvider: "",
      errorProvider: "",
    }
  );
});

test("resolveTopologyRecency normalizes provider ids before returning them", () => {
  const now = Date.parse("2026-06-07T10:00:00.000Z");
  const providerMetrics = {
    CX: {
      lastRequestAt: new Date(now - 1_000).toISOString(),
    },
  };

  const normalizeProviderId = (providerId?: string | null) => {
    const normalized = typeof providerId === "string" ? providerId.trim().toLowerCase() : "";
    return normalized === "cx" ? "codex" : normalized;
  };

  assert.deepEqual(resolveTopologyRecency(providerMetrics, normalizeProviderId, { now }), {
    lastProvider: "codex",
    errorProvider: "",
  });
});
