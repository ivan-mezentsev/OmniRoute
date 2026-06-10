import { NextResponse } from "next/server";
import { z } from "zod";
import { sanitizeErrorMessage } from "@omniroute/open-sse/utils/error";

import { applyPromptFiltersToBody, previewPromptFilters } from "@/lib/promptFilters/engine";
import { requireManagementAuth } from "@/lib/api/requireManagementAuth";
import { isValidationFailure, validateBody } from "@/shared/validation/helpers";
import type { PromptFilter } from "@/lib/promptFilters/types";

const promptFilterBlockSchema = z.object({
  id: z.string().trim().min(1).optional(),
  text: z.string().min(1, "block text is required"),
});

const inlineFilterSchema = z.object({
  id: z.string().optional().default("preview"),
  name: z.string().optional().default("Preview filter"),
  enabled: z.boolean().optional().default(true),
  uaPatterns: z.array(z.string().trim().min(1)).min(1),
  blocks: z.array(promptFilterBlockSchema).min(1),
  applyTo: z.enum(["system", "all"]).optional().default("system"),
});

const previewSchema = z.object({
  userAgent: z.string().min(1, "userAgent is required"),
  payload: z.record(z.string(), z.unknown()),
  filters: z.array(inlineFilterSchema).optional(),
});

async function parseJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const authError = await requireManagementAuth(request);
  if (authError) return authError;

  try {
    const rawBody = await parseJsonBody(request);
    if (rawBody === null) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const validation = validateBody(previewSchema, rawBody);
    if (isValidationFailure(validation)) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const { payload, userAgent, filters } = validation.data;
    const inlineFilters: PromptFilter[] | undefined = filters?.map((filter) => ({
      ...filter,
      blocks: filter.blocks.map((block, index) => ({
        id: block.id || `preview-block-${index + 1}`,
        text: block.text,
      })),
      matchCount: 0,
      createdAt: "preview",
      updatedAt: "preview",
    }));

    const result = inlineFilters
      ? applyPromptFiltersToBody(payload, userAgent, inlineFilters, { recordMatches: false })
      : await previewPromptFilters(payload, userAgent);

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: sanitizeErrorMessage(error) || "Failed to preview prompt filters" },
      { status: 500 }
    );
  }
}
