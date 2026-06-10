import { NextResponse } from "next/server";
import { z } from "zod";
import { sanitizeErrorMessage } from "@omniroute/open-sse/utils/error";

import {
  deletePromptFilter,
  getPromptFilter,
  updatePromptFilter,
} from "@/lib/db/promptFilters";
import { invalidatePromptFiltersCache } from "@/lib/promptFilters/engine";
import { requireManagementAuth } from "@/lib/api/requireManagementAuth";
import { isValidationFailure, validateBody } from "@/shared/validation/helpers";

const promptFilterBlockSchema = z.object({
  id: z.string().trim().min(1).optional(),
  text: z.string().min(1, "block text is required"),
});

const updatePromptFilterSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    enabled: z.boolean().optional(),
    uaPatterns: z.array(z.string().trim().min(1)).min(1).optional(),
    blocks: z.array(promptFilterBlockSchema).min(1).optional(),
    applyTo: z.enum(["system", "all"]).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "At least one update field is required");

type RouteParams = { params: Promise<{ id: string }> };

async function parseJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export async function GET(request: Request, { params }: RouteParams) {
  const authError = await requireManagementAuth(request);
  if (authError) return authError;

  try {
    const { id } = await params;
    const filter = getPromptFilter(id);
    if (!filter) {
      return NextResponse.json({ error: "Prompt filter not found" }, { status: 404 });
    }
    return NextResponse.json({ filter });
  } catch (error) {
    return NextResponse.json(
      { error: sanitizeErrorMessage(error) || "Failed to get prompt filter" },
      { status: 500 }
    );
  }
}

export async function PUT(request: Request, { params }: RouteParams) {
  const authError = await requireManagementAuth(request);
  if (authError) return authError;

  try {
    const { id } = await params;
    const rawBody = await parseJsonBody(request);
    if (rawBody === null) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const validation = validateBody(updatePromptFilterSchema, rawBody);
    if (isValidationFailure(validation)) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const filter = updatePromptFilter(id, validation.data);
    if (!filter) {
      return NextResponse.json({ error: "Prompt filter not found" }, { status: 404 });
    }

    invalidatePromptFiltersCache();
    return NextResponse.json({ filter });
  } catch (error) {
    return NextResponse.json(
      { error: sanitizeErrorMessage(error) || "Failed to update prompt filter" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request, { params }: RouteParams) {
  const authError = await requireManagementAuth(request);
  if (authError) return authError;

  try {
    const { id } = await params;
    const deleted = deletePromptFilter(id);
    if (!deleted) {
      return NextResponse.json({ error: "Prompt filter not found" }, { status: 404 });
    }

    invalidatePromptFiltersCache();
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: sanitizeErrorMessage(error) || "Failed to delete prompt filter" },
      { status: 500 }
    );
  }
}
