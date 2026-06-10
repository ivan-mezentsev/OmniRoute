"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { Card, ConfirmModal } from "@/shared/components";
import type { PromptFilter, PromptFilterApplyTo } from "@/lib/promptFilters/types";

type FeedbackState = { type: "success" | "error"; message: string } | null;

type FilterFormState = {
  id: string | null;
  name: string;
  enabled: boolean;
  uaPatternsText: string;
  applyTo: PromptFilterApplyTo;
  blocks: Array<{ id?: string; text: string }>;
};

const EMPTY_FORM: FilterFormState = {
  id: null,
  name: "",
  enabled: true,
  uaPatternsText: "Copilot*\nOpenCode*",
  applyTo: "system",
  blocks: [{ text: "" }],
};

function createFormFromFilter(filter: PromptFilter): FilterFormState {
  return {
    id: filter.id,
    name: filter.name,
    enabled: filter.enabled,
    uaPatternsText: filter.uaPatterns.join("\n"),
    applyTo: filter.applyTo,
    blocks: filter.blocks.map((block) => ({ id: block.id, text: block.text })),
  };
}

function extractErrorMessage(data: unknown, fallback: string): string {
  if (data && typeof data === "object" && "error" in data) {
    const error = (data as { error?: unknown }).error;
    if (typeof error === "string") return error;
    if (error && typeof error === "object" && "message" in error) {
      const message = (error as { message?: unknown }).message;
      if (typeof message === "string") return message;
    }
  }
  return fallback;
}

export function PromptFiltersPageClient() {
  const t = useTranslations("promptFilters");

  const [filters, setFilters] = useState<PromptFilter[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const [form, setForm] = useState<FilterFormState>(EMPTY_FORM);
  const [deleteTarget, setDeleteTarget] = useState<PromptFilter | null>(null);
  const [previewUserAgent, setPreviewUserAgent] = useState("CopilotChat/1.0");
  const [previewPayload, setPreviewPayload] = useState("{}");
  const [previewResult, setPreviewResult] = useState<Record<string, unknown> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/prompt-filters");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(extractErrorMessage(data, t("loadFailed")));
      setFilters(Array.isArray(data.filters) ? data.filters : []);
    } catch (err) {
      setFeedback({ type: "error", message: err instanceof Error ? err.message : t("loadFailed") });
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = useMemo(
    () => ({
      total: filters.length,
      enabled: filters.filter((filter) => filter.enabled).length,
      blocks: filters.reduce((sum, filter) => sum + filter.blocks.length, 0),
      matches: filters.reduce((sum, filter) => sum + filter.matchCount, 0),
    }),
    [filters]
  );

  const buildPayload = () => ({
    name: form.name.trim(),
    enabled: form.enabled,
    uaPatterns: form.uaPatternsText
      .split(/\r?\n/)
      .map((pattern) => pattern.trim())
      .filter(Boolean),
    applyTo: form.applyTo,
    blocks: form.blocks
      .map((block) => ({ id: block.id, text: block.text }))
      .filter((block) => block.text.trim().length > 0),
  });

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setPreviewResult(null);
  };

  const handleSave = async () => {
    setSaving(true);
    setFeedback(null);
    try {
      const payload = buildPayload();
      const res = await fetch(form.id ? `/api/prompt-filters/${form.id}` : "/api/prompt-filters", {
        method: form.id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(extractErrorMessage(data, t("saveFailed")));
      setFeedback({ type: "success", message: t("saveSuccess") });
      resetForm();
      await load();
    } catch (err) {
      setFeedback({ type: "error", message: err instanceof Error ? err.message : t("saveFailed") });
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (filter: PromptFilter) => {
    setFeedback(null);
    try {
      const res = await fetch(`/api/prompt-filters/${filter.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !filter.enabled }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(extractErrorMessage(data, t("saveFailed")));
      setFilters((prev) =>
        prev.map((item) => (item.id === filter.id ? { ...item, enabled: !filter.enabled } : item))
      );
    } catch (err) {
      setFeedback({ type: "error", message: err instanceof Error ? err.message : t("saveFailed") });
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setFeedback(null);
    try {
      const res = await fetch(`/api/prompt-filters/${deleteTarget.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(extractErrorMessage(data, t("deleteFailed")));
      setFilters((prev) => prev.filter((filter) => filter.id !== deleteTarget.id));
      setDeleteTarget(null);
      setFeedback({ type: "success", message: t("deleteSuccess") });
      if (form.id === deleteTarget.id) resetForm();
    } catch (err) {
      setFeedback({ type: "error", message: err instanceof Error ? err.message : t("deleteFailed") });
    }
  };

  const handlePreview = async () => {
    setPreviewing(true);
    setFeedback(null);
    try {
      const payload = JSON.parse(previewPayload);
      const filterPayload = buildPayload();
      const inlineFilters = filterPayload.blocks.length > 0 ? [
        {
          id: form.id || "preview",
          ...filterPayload,
          name: filterPayload.name || t("previewFilterName"),
        },
      ] : undefined;
      const res = await fetch("/api/prompt-filters/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userAgent: previewUserAgent,
          payload,
          ...(inlineFilters ? { filters: inlineFilters } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(extractErrorMessage(data, t("previewFailed")));
      setPreviewResult(data);
    } catch (err) {
      setFeedback({
        type: "error",
        message: err instanceof Error ? err.message : t("previewFailed"),
      });
    } finally {
      setPreviewing(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-text-main">{t("title")}</h1>
          <p className="mt-0.5 text-sm text-text-muted">{t("description")}</p>
        </div>
        <button
          type="button"
          onClick={resetForm}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-main transition-colors hover:bg-surface/60"
        >
          <span className="material-symbols-outlined text-[18px]">add</span>
          {t("newFilter")}
        </button>
      </div>

      {feedback && (
        <div
          className={`rounded-lg border px-4 py-3 text-sm ${
            feedback.type === "success"
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"
              : "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-300"
          }`}
        >
          {feedback.message}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: t("total"), value: stats.total, icon: "content_cut", tone: "text-primary" },
          { label: t("enabled"), value: stats.enabled, icon: "toggle_on", tone: "text-emerald-500" },
          { label: t("blocks"), value: stats.blocks, icon: "segment", tone: "text-amber-500" },
          { label: t("matches"), value: stats.matches, icon: "ads_click", tone: "text-sky-500" },
        ].map((stat) => (
          <Card key={stat.label} className="p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-text-muted">
                  {stat.label}
                </p>
                <p className="mt-1 text-2xl font-semibold text-text-main">{stat.value}</p>
              </div>
              <span className={`material-symbols-outlined text-[24px] ${stat.tone}`}>
                {stat.icon}
              </span>
            </div>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-4">
          <Card className="overflow-hidden">
            <div className="flex items-center justify-between gap-3 border-b border-border p-4">
              <div>
                <h2 className="text-base font-semibold text-text-main">{t("configuredFilters")}</h2>
                <p className="mt-1 text-xs text-text-muted">{t("configuredFiltersDesc")}</p>
              </div>
              <button
                type="button"
                onClick={() => void load()}
                disabled={loading}
                className="rounded-lg border border-border p-2 text-text-muted transition-colors hover:bg-surface/60 hover:text-text-main disabled:opacity-40"
              >
                <span className={`material-symbols-outlined text-[18px] ${loading ? "animate-spin" : ""}`}>
                  refresh
                </span>
              </button>
            </div>
            <div className="divide-y divide-border">
              {loading ? (
                <div className="p-6 text-sm text-text-muted">{t("loading")}</div>
              ) : filters.length === 0 ? (
                <div className="p-6 text-sm text-text-muted">{t("empty")}</div>
              ) : (
                filters.map((filter) => (
                  <div key={filter.id} className="p-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-medium text-text-main">{filter.name}</h3>
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs ${
                              filter.enabled
                                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"
                                : "bg-surface text-text-muted"
                            }`}
                          >
                            {filter.enabled ? t("enabled") : t("disabled")}
                          </span>
                          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
                            {filter.applyTo === "all" ? t("scopeAll") : t("scopeSystem")}
                          </span>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {filter.uaPatterns.map((pattern) => (
                            <code key={pattern} className="rounded bg-surface px-2 py-1 text-xs text-text-muted">
                              {pattern}
                            </code>
                          ))}
                        </div>
                        <p className="mt-2 text-xs text-text-muted">
                          {t("filterMeta", {
                            blocks: filter.blocks.length,
                            matches: filter.matchCount,
                          })}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => void handleToggle(filter)}
                          className="rounded-lg border border-border px-3 py-1.5 text-xs text-text-main transition-colors hover:bg-surface/60"
                        >
                          {filter.enabled ? t("disable") : t("enable")}
                        </button>
                        <button
                          type="button"
                          onClick={() => setForm(createFormFromFilter(filter))}
                          className="rounded-lg border border-border px-3 py-1.5 text-xs text-text-main transition-colors hover:bg-surface/60"
                        >
                          {t("edit")}
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(filter)}
                          className="rounded-lg border border-red-500/30 px-3 py-1.5 text-xs text-red-500 transition-colors hover:bg-red-500/10"
                        >
                          {t("delete")}
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>

          <Card className="p-4">
            <div className="mb-4">
              <h2 className="text-base font-semibold text-text-main">{t("previewTitle")}</h2>
              <p className="mt-1 text-xs text-text-muted">{t("previewDesc")}</p>
            </div>
            <div className="space-y-3">
              <label className="block text-sm font-medium text-text-main">
                {t("previewUserAgent")}
                <input
                  value={previewUserAgent}
                  onChange={(event) => setPreviewUserAgent(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-text-main outline-none focus:border-primary"
                />
              </label>
              <label className="block text-sm font-medium text-text-main">
                {t("previewPayload")}
                <textarea
                  value={previewPayload}
                  onChange={(event) => setPreviewPayload(event.target.value)}
                  rows={8}
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs text-text-main outline-none focus:border-primary"
                />
              </label>
              <button
                type="button"
                onClick={() => void handlePreview()}
                disabled={previewing}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-[18px]">visibility</span>
                {previewing ? t("previewing") : t("runPreview")}
              </button>
              {previewResult && (
                <pre className="max-h-[420px] overflow-auto rounded-lg border border-border bg-surface p-3 text-xs text-text-main">
                  {JSON.stringify(previewResult, null, 2)}
                </pre>
              )}
            </div>
          </Card>
        </div>

        <Card className="h-fit p-4">
          <div className="mb-4">
            <h2 className="text-base font-semibold text-text-main">
              {form.id ? t("editFilter") : t("createFilter")}
            </h2>
            <p className="mt-1 text-xs text-text-muted">{t("formDesc")}</p>
          </div>

          <div className="space-y-4">
            <label className="block text-sm font-medium text-text-main">
              {t("name")}
              <input
                value={form.name}
                onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                placeholder={t("namePlaceholder")}
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-text-main outline-none focus:border-primary"
              />
            </label>

            <label className="flex items-center gap-2 text-sm text-text-main">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(event) => setForm((prev) => ({ ...prev, enabled: event.target.checked }))}
                className="h-4 w-4 rounded border-border"
              />
              {t("enabled")}
            </label>

            <label className="block text-sm font-medium text-text-main">
              {t("uaPatterns")}
              <textarea
                value={form.uaPatternsText}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, uaPatternsText: event.target.value }))
                }
                rows={4}
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs text-text-main outline-none focus:border-primary"
              />
              <span className="mt-1 block text-xs text-text-muted">{t("uaPatternsHelp")}</span>
            </label>

            <label className="block text-sm font-medium text-text-main">
              {t("applyTo")}
              <select
                value={form.applyTo}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, applyTo: event.target.value as PromptFilterApplyTo }))
                }
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-text-main outline-none focus:border-primary"
              >
                <option value="system">{t("scopeSystem")}</option>
                <option value="all">{t("scopeAll")}</option>
              </select>
            </label>

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-medium text-text-main">{t("blocksToRemove")}</h3>
                <button
                  type="button"
                  onClick={() =>
                    setForm((prev) => ({ ...prev, blocks: [...prev.blocks, { text: "" }] }))
                  }
                  className="rounded-lg border border-border px-3 py-1.5 text-xs text-text-main transition-colors hover:bg-surface/60"
                >
                  {t("addBlock")}
                </button>
              </div>
              {form.blocks.map((block, index) => (
                <div key={block.id || index} className="rounded-lg border border-border p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-xs font-medium uppercase tracking-wider text-text-muted">
                      {t("blockNumber", { number: index + 1 })}
                    </span>
                    {form.blocks.length > 1 && (
                      <button
                        type="button"
                        onClick={() =>
                          setForm((prev) => ({
                            ...prev,
                            blocks: prev.blocks.filter((_, blockIndex) => blockIndex !== index),
                          }))
                        }
                        className="text-xs text-red-500 hover:underline"
                      >
                        {t("removeBlock")}
                      </button>
                    )}
                  </div>
                  <textarea
                    value={block.text}
                    onChange={(event) =>
                      setForm((prev) => ({
                        ...prev,
                        blocks: prev.blocks.map((item, blockIndex) =>
                          blockIndex === index ? { ...item, text: event.target.value } : item
                        ),
                      }))
                    }
                    rows={6}
                    placeholder={t("blockPlaceholder")}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs text-text-main outline-none focus:border-primary"
                  />
                </div>
              ))}
            </div>

            <div className="flex flex-wrap gap-2 pt-2">
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-[18px]">save</span>
                {saving ? t("saving") : t("save")}
              </button>
              <button
                type="button"
                onClick={resetForm}
                className="rounded-lg border border-border px-4 py-2 text-sm text-text-main transition-colors hover:bg-surface/60"
              >
                {t("cancel")}
              </button>
            </div>
          </div>
        </Card>
      </div>

      <ConfirmModal
        isOpen={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title={t("delete")}
        message={t("deleteConfirm")}
        confirmText={t("delete")}
        cancelText={t("cancel")}
      />
    </div>
  );
}
