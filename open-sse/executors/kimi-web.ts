/**
 * KimiWebExecutor — Kimi Web via www.kimi.com Connect-RPC gateway.
 *
 * Routes requests through Kimi's current consumer web API.
 *
 * Endpoint: POST https://www.kimi.com/apiv2/kimi.gateway.chat.v1.ChatService/Chat
 * Auth: kimi-auth cookie value (or a full Cookie header that contains kimi-auth)
 */
import { randomUUID } from "node:crypto";

import { BaseExecutor, type ExecuteInput } from "./base.ts";
import { makeExecutorErrorResult as makeErrorResult } from "../utils/error.ts";
import {
  buildKimiWebChatHeaders,
  decodeKimiConnectEventStream,
  decodeKimiConnectFrames,
  encodeKimiConnectFrame,
  extractKimiWebEventDelta,
  KIMI_WEB_BASE_URL,
  KIMI_WEB_CHAT_PATH,
  parseKimiWebAuth,
  resolveKimiWebModel,
} from "../services/kimiWeb.ts";

type JsonRecord = Record<string, unknown>;

const CHAT_URL = `${KIMI_WEB_BASE_URL}${KIMI_WEB_CHAT_PATH}`;
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
    if (record.type === "text") {
      const directText = textValue(record.text);
      const nestedText = textValue(asRecord(record.text).content);
      if (directText) parts.push(directText);
      else if (nestedText) parts.push(nestedText);
      continue;
    }
    const fallbackText = textValue(record.text);
    if (fallbackText) parts.push(fallbackText);
  }

  return parts.join("\n").trim();
}

function buildAssistantToolCallsText(message: JsonRecord): string {
  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  if (toolCalls.length === 0) return "";

  const blocks = toolCalls
    .map((toolCall) => {
      const record = asRecord(toolCall);
      const fn = asRecord(record.function);
      const name = textValue(fn.name);
      const args = textValue(fn.arguments);
      return name ? `[call:${name}]${args}[/call]` : "";
    })
    .filter(Boolean);

  return blocks.length > 0 ? `[function_calls]\n${blocks.join("\n")}\n[/function_calls]` : "";
}

function formatKimiPrompt(messages: JsonRecord[]): string {
  const systemLines: string[] = [];
  const bodyLines: string[] = [];

  for (const message of messages) {
    let role = textValue(message.role) || "user";
    let content = extractMessageText(message.content);

    if (role === "assistant") {
      const toolCallsText = buildAssistantToolCallsText(message);
      if (toolCallsText) content = toolCallsText;
    }

    if (role === "tool") {
      const toolCallId = textValue(message.tool_call_id);
      role = "user";
      content = toolCallId ? `[TOOL_RESULT for ${toolCallId}] ${content}`.trim() : content;
    }

    if (!content) continue;
    if (role === "system") {
      systemLines.push(content);
      continue;
    }

    bodyLines.push(`${role}:${content}`);
  }

  return [...systemLines.map((line) => `system:${line}`), ...bodyLines].join("\n").trim();
}

function chatCompletionChunk(
  id: string,
  model: string,
  delta: JsonRecord,
  finishReason: "stop" | null = null
) {
  return {
    id,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
}

function sse(data: unknown): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(data)}\n\n`);
}

function toUint8Array(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return new Uint8Array(0);
}

function createStreamResponse(upstream: Response, model: string, signal?: AbortSignal | null): Response {
  const id = `chatcmpl-kimi-${randomUUID()}`;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let sentRole = false;
      let phase: "thinking" | "answer" | null = null;
      let closed = false;

      const abort = () => {
        closed = true;
        controller.error(new DOMException("The operation was aborted", "AbortError"));
      };
      signal?.addEventListener("abort", abort, { once: true });

      try {
        for await (const frame of decodeKimiConnectEventStream(upstream.body)) {
          if (closed || frame.flag !== 0x00 || !frame.event) continue;

          const delta = extractKimiWebEventDelta(frame.event, phase);
          phase = delta.phase;

          if (delta.error) throw new Error(delta.error);

          if ((delta.reasoningContent || delta.content) && !sentRole) {
            sentRole = true;
            controller.enqueue(sse(chatCompletionChunk(id, model, { role: "assistant" })));
          }

          if (delta.reasoningContent) {
            controller.enqueue(
              sse(chatCompletionChunk(id, model, { reasoning_content: delta.reasoningContent }))
            );
          }

          if (delta.content) {
            controller.enqueue(sse(chatCompletionChunk(id, model, { content: delta.content })));
          }

          if (delta.done) break;
        }

        controller.enqueue(sse(chatCompletionChunk(id, model, {}, "stop")));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch (error) {
        if (!signal?.aborted) controller.error(error);
      } finally {
        signal?.removeEventListener("abort", abort);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

export class KimiWebExecutor extends BaseExecutor {
  constructor() {
    super("kimi-web", { id: "kimi-web", baseUrl: KIMI_WEB_BASE_URL });
  }

  async execute(input: ExecuteInput) {
    const { body, credentials, signal, stream: wantStream } = input;
    const bodyObj = asRecord(body);
    const messages = Array.isArray(bodyObj.messages)
      ? bodyObj.messages.map((message) => asRecord(message))
      : [];
    const prompt = formatKimiPrompt(messages);
    const resolvedModel = resolveKimiWebModel(textValue(bodyObj.model) || input.model);
    const auth = parseKimiWebAuth(credentials?.apiKey || credentials?.accessToken || "");

    if (!auth.token) {
      return makeErrorResult(
        400,
        "Kimi Web requires a kimi-auth token or a full Cookie header containing kimi-auth.",
        body,
        CHAT_URL
      );
    }

    const requestBody: JsonRecord = {
      scenario: resolvedModel.scenario,
      tools: resolvedModel.useSearch ? [{ type: "TOOL_TYPE_SEARCH", search: {} }] : [],
      message: {
        role: "user",
        blocks: [{ message_id: "", text: { content: prompt || "Hello" } }],
        scenario: resolvedModel.scenario,
      },
      options: {
        thinking: resolvedModel.thinking,
      },
    };

    if (resolvedModel.kimiPlusId) requestBody.kimiPlusId = resolvedModel.kimiPlusId;
    if (resolvedModel.agentMode) requestBody.agentMode = resolvedModel.agentMode;

    const headers = buildKimiWebChatHeaders(auth);

    let upstream: Response;
    try {
      upstream = await fetch(CHAT_URL, {
        method: "POST",
        headers,
        body: encodeKimiConnectFrame(requestBody) as unknown as BodyInit,
        signal: signal || undefined,
      });
    } catch (error) {
      return makeErrorResult(
        502,
        `Kimi fetch failed: ${error instanceof Error ? error.message : "unknown"}`,
        body,
        CHAT_URL
      );
    }

    if (!upstream.ok) {
      const errorText = await upstream.text().catch(() => "");
      return makeErrorResult(upstream.status, `Kimi error: ${errorText}`, body, CHAT_URL);
    }

    if (wantStream) {
      return {
        response: createStreamResponse(upstream, resolvedModel.id, signal),
        url: CHAT_URL,
        headers,
        transformedBody: requestBody,
      };
    }

    const buffer = toUint8Array(await upstream.arrayBuffer());
    let phase: "thinking" | "answer" | null = null;
    let content = "";
    let reasoningContent = "";

    for (const frame of decodeKimiConnectFrames(buffer)) {
      if (frame.flag !== 0x00 || !frame.event) continue;

      const delta = extractKimiWebEventDelta(frame.event, phase);
      phase = delta.phase;

      if (delta.error) {
        return makeErrorResult(502, `Kimi error: ${delta.error}`, body, CHAT_URL);
      }

      if (delta.reasoningContent) reasoningContent += delta.reasoningContent;
      if (delta.content) content += delta.content;
      if (delta.done) break;
    }

    return {
      response: new Response(
        JSON.stringify({
          id: `chatcmpl-kimi-${randomUUID()}`,
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: resolvedModel.id,
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content,
                ...(reasoningContent ? { reasoning_content: reasoningContent } : {}),
              },
              finish_reason: "stop",
            },
          ],
        }),
        { headers: { "Content-Type": "application/json" } }
      ),
      url: CHAT_URL,
      headers,
      transformedBody: requestBody,
    };
  }
}
