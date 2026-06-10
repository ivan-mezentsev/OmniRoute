import { NextResponse } from "next/server";
import { z } from "zod";
import { sanitizeErrorMessage } from "@omniroute/open-sse/utils/error";

import { createPromptFilter, getPromptFilters } from "@/lib/db/promptFilters";
import { invalidatePromptFiltersCache } from "@/lib/promptFilters/engine";
import { requireManagementAuth } from "@/lib/api/requireManagementAuth";
import { isValidationFailure, validateBody } from "@/shared/validation/helpers";

const promptFilterBlockSchema = z.object({
  id: z.string().trim().min(1).optional(),
  text: z.string().min(1, "block text is required"),
});

const createPromptFilterSchema = z.object({
  name: z.string().trim().min(1, "name is required").max(200),
  enabled: z.boolean().optional().default(true),
  uaPatterns: z.array(z.string().trim().min(1)).min(1, "at least one UA pattern is required"),
  blocks: z.array(promptFilterBlockSchema).min(1, "at least one block is required"),
  applyTo: z.enum(["system", "all"]).optional().default("system"),
});

async function parseJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const authError = await requireManagementAuth(request);
  if (authError) return authError;

  try {
    return NextResponse.json({ filters: getPromptFilters() });
  } catch (error) {
    return NextResponse.json(
      { error: sanitizeErrorMessage(error) || "Failed to list prompt filters" },
      { status: 500 }
    );
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
    const validation = validateBody(createPromptFilterSchema, rawBody);
    if (isValidationFailure(validation)) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const filter = createPromptFilter(validation.data);
    invalidatePromptFiltersCache();
    return NextResponse.json({ filter }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: sanitizeErrorMessage(error) || "Failed to create prompt filter" },
      { status: 500 }
    );
  }
}
