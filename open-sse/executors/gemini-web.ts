/**
 * GeminiWebExecutor — Gemini Web session provider via consumer HTTP RPCs.
 *
 * Routes requests through Gemini Web without browser automation by using the
 * same cookie-authenticated bootstrap + GetUserStatus + StreamGenerate flow
 * that powers the web application.
 */

import { BaseExecutor, type ExecuteInput } from "./base.ts";
import { makeExecutorErrorResult as makeErrorResult } from "../utils/error.ts";
import {
  buildGeminiWebBatchHeaders,
  buildGeminiWebBatchUrl,
  buildGeminiWebBootstrapHeaders,
  buildGeminiWebCookieHeader,
  buildGeminiWebGetUserStatusBody,
  buildGeminiWebModelHeader,
  buildGeminiWebStreamGenerateBody,
  buildGeminiWebStreamGenerateUrl,
  buildGeminiWebStreamHeaders,
  extractGeminiWebAccountPath,
  extractGeminiWebBootstrap,
  extractGeminiWebRpcBody,
  GEMINI_WEB_APP_URL,
  parseGeminiWebStreamResponse,
  parseGeminiWebUserStatus,
  resolveGeminiWebRequestedModel,
} from "../services/geminiWebModels.ts";

type JsonRecord = Record<string, unknown>;

const encoder = new TextEncoder();

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function textValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function extractMessageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  const parts: string[] = [];
  for (const part of content) {
    if (typeof part === "string") {
      parts.push(part);
      continue;
    }

    const record = asRecord(part);
    const text = textValue(record.text) || textValue(asRecord(record.text).content);
    if (text) parts.push(text);
  }

  return parts.join("\n").trim();
}

function extractSystemInstruction(body: JsonRecord, messages: JsonRecord[]): string {
  const systemParts: string[] = [];

  const directSystem = textValue(body.system);
  if (directSystem.trim()) {
    systemParts.push(directSystem.trim());
  }

  const directInstructions = textValue(body.instructions);
  if (directInstructions.trim()) {
    systemParts.push(directInstructions.trim());
  }

  for (const message of messages) {
    let role = textValue(message.role) || "user";
    if (role === "developer") role = "system";
    if (role !== "system") continue;

    const content = extractMessageText(message.content).trim();
    if (content) {
      systemParts.push(content);
    }
  }

  return systemParts.join("\n\n").trim();
}

function buildGeminiWebPrompt(systemInstruction: string, prompt: string): string {
  const normalizedPrompt = prompt.trim();
  const normalizedSystemInstruction = systemInstruction.trim();

  if (!normalizedSystemInstruction) {
    return normalizedPrompt;
  }

  return [`[System Instructions]`, normalizedSystemInstruction, "", normalizedPrompt].join("\n").trim();
}

function formatChatCompletion(content: string, model: string, finishReason = "stop") {
  return {
    id: `chatcmpl-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: finishReason }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

function formatStreamChunk(content: string, model: string, finishReason: string | null = null) {
  return {
    id: `chatcmpl-${Date.now()}`,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta: content ? { content } : {}, finish_reason: finishReason }],
  };
}

function sse(data: unknown): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(data)}\n\n`);
}

function getErrorSnippet(text: string): string {
  const normalized = text.trim();
  return normalized.length > 200 ? `${normalized.slice(0, 200)}...` : normalized;
}

function looksLikeGeminiAuthPage(responseUrl: string, html: string): boolean {
  const url = responseUrl.toLowerCase();
  const text = html.toLowerCase();
  return (
    url.includes("accounts.google.com") ||
    url.includes("/signin") ||
    text.includes("accounts.google.com") ||
    text.includes("sign in") ||
    text.includes("log in")
  );
}

export class GeminiWebExecutor extends BaseExecutor {
  constructor() {
    super("gemini-web", { id: "gemini-web", baseUrl: GEMINI_WEB_APP_URL });
  }

  async execute(input: ExecuteInput) {
    const { body, credentials, signal, stream: wantStream } = input;
    const bodyObj = asRecord(body);
    const messages = Array.isArray(bodyObj.messages)
      ? bodyObj.messages.map((message) => asRecord(message))
      : [];
    const systemInstruction = extractSystemInstruction(bodyObj, messages);
    const lastUserMessage = messages.filter((message) => message.role === "user").pop();
    const userPrompt = extractMessageText(lastUserMessage?.content).trim();
    const requestedModel = textValue(bodyObj.model) || input.model;
    if (!userPrompt) {
      return makeErrorResult(400, "No user message found", body, GEMINI_WEB_APP_URL);
    }

    const prompt = buildGeminiWebPrompt(systemInstruction, userPrompt);
    const cookieHeader = buildGeminiWebCookieHeader(
      credentials?.apiKey || credentials?.accessToken || ""
    );

    if (!cookieHeader) {
      return makeErrorResult(
        401,
        "Gemini Web requires __Secure-1PSID cookies or a full Cookie header from gemini.google.com.",
        body,
        GEMINI_WEB_APP_URL
      );
    }

    try {
      const bootstrapResponse = await fetch(GEMINI_WEB_APP_URL, {
        method: "GET",
        headers: buildGeminiWebBootstrapHeaders(cookieHeader),
        signal: signal || undefined,
      });

      if (!bootstrapResponse.ok) {
        return makeErrorResult(
          bootstrapResponse.status,
          `Gemini Web bootstrap failed: ${bootstrapResponse.status}`,
          body,
          GEMINI_WEB_APP_URL
        );
      }

      const bootstrapAccountPath = extractGeminiWebAccountPath(bootstrapResponse.url);
      const bootstrapHtml = await bootstrapResponse.text();
      const bootstrap = extractGeminiWebBootstrap(bootstrapHtml);
      if (!bootstrap?.accessToken) {
        const authLikely = looksLikeGeminiAuthPage(bootstrapResponse.url, bootstrapHtml);
        return makeErrorResult(
          authLikely ? 401 : 502,
          authLikely
            ? "Failed to extract Gemini Web bootstrap tokens. Your Gemini Web cookies may be invalid or expired."
            : "Failed to extract Gemini Web bootstrap tokens. Gemini returned an unexpected bootstrap page.",
          body,
          bootstrapResponse.url || GEMINI_WEB_APP_URL
        );
      }

      const modelsUrl = buildGeminiWebBatchUrl({
        language: bootstrap.language,
        buildLabel: bootstrap.buildLabel,
        sessionId: bootstrap.sessionId,
        accountPath: bootstrapAccountPath,
        sourcePath: `${bootstrapAccountPath || ""}/app` || "/app",
      });
      const modelsResponse = await fetch(modelsUrl, {
        method: "POST",
        headers: buildGeminiWebBatchHeaders(cookieHeader),
        body: buildGeminiWebGetUserStatusBody(bootstrap.accessToken),
        signal: signal || undefined,
      });

      if (!modelsResponse.ok) {
        return makeErrorResult(
          modelsResponse.status,
          `Gemini Web model discovery failed: ${modelsResponse.status}`,
          body,
          modelsUrl
        );
      }

      const rpcPayload = extractGeminiWebRpcBody(await modelsResponse.text());
      if (!rpcPayload) {
        return makeErrorResult(502, "Gemini Web model RPC payload missing", body, modelsUrl);
      }

      const userStatus = parseGeminiWebUserStatus(rpcPayload.body);
      if (rpcPayload.rejectCode === 1016 || userStatus.statusCode === 1016) {
        return makeErrorResult(401, "Invalid or expired Gemini Web cookies", body, modelsUrl);
      }

      const resolvedModel = resolveGeminiWebRequestedModel(requestedModel, userStatus);
      if (!resolvedModel) {
        return makeErrorResult(502, "Gemini Web returned no available models", body, modelsUrl);
      }

      const streamUrl = buildGeminiWebStreamGenerateUrl({
        language: bootstrap.language,
        buildLabel: bootstrap.buildLabel,
        sessionId: bootstrap.sessionId,
        accountPath: bootstrapAccountPath,
      });
      const { body: streamBody, requestUuid } = buildGeminiWebStreamGenerateBody({
        accessToken: bootstrap.accessToken,
        prompt,
        language: bootstrap.language,
        modelSelector: resolvedModel.selector,
      });
      const streamHeaders = buildGeminiWebStreamHeaders({
        cookieHeader,
        modelHeader: buildGeminiWebModelHeader(resolvedModel.modelId, resolvedModel.selector),
        requestUuid,
      });

      const upstream = await fetch(streamUrl, {
        method: "POST",
        headers: streamHeaders,
        body: streamBody,
        signal: signal || undefined,
      });

      if (!upstream.ok) {
        const errorText = await upstream.text().catch(() => "");
        return makeErrorResult(
          upstream.status,
          `Gemini Web StreamGenerate failed: ${upstream.status}${errorText ? ` ${getErrorSnippet(errorText)}` : ""}`,
          body,
          streamUrl
        );
      }

      const parsed = parseGeminiWebStreamResponse(await upstream.text());
      if (parsed.errorCode === 1052) {
        return makeErrorResult(
          409,
          `Gemini Web model unavailable: ${resolvedModel.id}`,
          body,
          streamUrl
        );
      }
      if (parsed.errorCode !== 0) {
        return makeErrorResult(
          502,
          `Gemini Web returned envelope error ${parsed.errorCode}`,
          body,
          streamUrl
        );
      }
      if (!parsed.text) {
        return makeErrorResult(502, "No response from Gemini Web", body, streamUrl);
      }

      if (wantStream) {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(sse(formatStreamChunk(parsed.text, resolvedModel.id)));
            controller.enqueue(sse(formatStreamChunk("", resolvedModel.id, "stop")));
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          },
        });

        return {
          response: new Response(stream, {
            status: 200,
            headers: {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              Connection: "keep-alive",
            },
          }),
          url: streamUrl,
          headers: streamHeaders,
          transformedBody: body,
        };
      }

      return {
        response: new Response(JSON.stringify(formatChatCompletion(parsed.text, resolvedModel.id)), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
        url: streamUrl,
        headers: streamHeaders,
        transformedBody: body,
      };
    } catch (error) {
      if (signal?.aborted) {
        return makeErrorResult(499, "Request aborted", body, GEMINI_WEB_APP_URL);
      }

      return makeErrorResult(
        500,
        error instanceof Error ? error.message : "Unknown Gemini Web error",
        body,
        GEMINI_WEB_APP_URL
      );
    }
  }
}
