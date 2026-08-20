import type { LlmProtocol, ModelConfig } from "./types";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CompleteChatOptions {
  maxTokens?: number;
  temperature?: number;
  webSearch?: boolean;
  stream?: boolean;
  maxToolCalls?: number;
  onProgress?: (update: LlmProgressUpdate) => void;
  jsonSchema?: {
    name: string;
    schema: Record<string, unknown>;
  };
}

export type LlmProgressPhase =
  | "request_sent"
  | "response_started"
  | "tool_running"
  | "output_streaming"
  | "retrying"
  | "completed";

export interface LlmProgressUpdate {
  phase: LlmProgressPhase;
  tool?: string;
  attempt?: number;
  maxAttempts?: number;
  delayMs?: number;
  message?: string;
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

function joinUrl(base: string, pathPart: string): string {
  const normalized = trimSlash(base);
  if (
    pathPart.startsWith("/v1/") &&
    (normalized.endsWith("/v1") || normalized.endsWith("/openai/v1"))
  ) {
    return `${normalized}${pathPart.slice(3)}`;
  }
  if (pathPart.startsWith("/v1beta/") && normalized.endsWith("/v1beta")) {
    return `${normalized}${pathPart.slice(7)}`;
  }
  return `${normalized}${pathPart}`;
}

function extractTextFromUnknown(data: unknown): string {
  if (typeof data === "string") return data;
  if (!data || typeof data !== "object") return "";
  const record = data as Record<string, unknown>;

  if (typeof record.output_text === "string" && record.output_text.trim()) {
    return record.output_text;
  }

  const choices = record.choices;
  if (Array.isArray(choices) && choices[0] && typeof choices[0] === "object") {
    const choice = choices[0] as Record<string, unknown>;
    const message = choice.message as Record<string, unknown> | undefined;
    if (message && typeof message.content === "string") return message.content;
    if (typeof choice.text === "string") return choice.text;
  }

  const content = record.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && "text" in item) {
          const text = (item as { text?: unknown }).text;
          return typeof text === "string" ? text : "";
        }
        return "";
      })
      .join("");
  }

  const output = record.output;
  if (Array.isArray(output)) {
    return output
      .flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const parts = (item as { content?: unknown }).content;
        if (!Array.isArray(parts)) return [];
        return parts.map((part) => {
          if (part && typeof part === "object" && "text" in part) {
            const text = (part as { text?: unknown }).text;
            return typeof text === "string" ? text : "";
          }
          return "";
        });
      })
      .join("");
  }

  const candidates = record.candidates;
  if (Array.isArray(candidates) && candidates[0] && typeof candidates[0] === "object") {
    const cand = candidates[0] as { content?: { parts?: Array<{ text?: string }> } };
    return (cand.content?.parts ?? []).map((part) => part.text ?? "").join("");
  }

  return "";
}

async function readError(response: Response): Promise<string> {
  if (response.status === 524) {
    return "上游网关等待模型超时";
  }

  const raw = await response.text();
  try {
    const data = JSON.parse(raw) as {
      error?: { message?: unknown } | string;
      message?: unknown;
      detail?: unknown;
    };
    const message =
      (typeof data.error === "object" && typeof data.error?.message === "string"
        ? data.error.message
        : typeof data.error === "string"
          ? data.error
          : typeof data.message === "string"
            ? data.message
            : typeof data.detail === "string"
              ? data.detail
              : "");
    if (message.trim()) return message.trim().slice(0, 500);
  } catch {
    // Non-JSON gateway errors are normalized below.
  }

  if (/<!doctype\s+html|<html\b/i.test(raw)) {
    return "上游网关返回 HTML 错误页";
  }
  return raw.replace(/\s+/g, " ").trim().slice(0, 500) || response.statusText;
}

function streamErrorMessage(payload: Record<string, unknown>): string {
  const error = payload.error;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  const message = payload.message;
  return typeof message === "string" ? message : "模型流式响应失败";
}

function reportProgress(options: CompleteChatOptions | undefined, update: LlmProgressUpdate) {
  try {
    options?.onProgress?.(update);
  } catch {
    // Progress reporting must never fail the model request.
  }
}

async function readEventStreamText(
  response: Response,
  options: CompleteChatOptions | undefined,
): Promise<string> {
  if (!response.body) throw new Error("模型流式响应为空");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let deltaText = "";
  let finalText = "";
  const reported = new Set<LlmProgressPhase>();

  const reportOnce = (update: LlmProgressUpdate): void => {
    if (reported.has(update.phase)) return;
    reported.add(update.phase);
    reportProgress(options, update);
  };

  const consumeEvent = (block: string): void => {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n")
      .trim();
    if (!data || data === "[DONE]") return;

    let payload: Record<string, unknown>;
    try {
      const parsed = JSON.parse(data) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
      payload = parsed as Record<string, unknown>;
    } catch {
      return;
    }

    const type = typeof payload.type === "string" ? payload.type : "";
    if (type === "error") {
      throw new Error(streamErrorMessage(payload));
    }
    const item = payload.item;
    const itemType = item && typeof item === "object"
      ? (item as { type?: unknown }).type
      : undefined;
    if (type.includes("web_search_call") || itemType === "web_search_call") {
      reportOnce({ phase: "tool_running", tool: "web_search" });
    }
    if (type === "response.output_text.delta" && typeof payload.delta === "string") {
      reportOnce({ phase: "output_streaming" });
      deltaText += payload.delta;
      return;
    }
    if (type === "response.output_text.done" && typeof payload.text === "string") {
      finalText = payload.text;
      return;
    }
    if (type === "response.completed" && payload.response) {
      finalText = extractTextFromUnknown(payload.response);
      return;
    }

    const choices = payload.choices;
    if (Array.isArray(choices) && choices[0] && typeof choices[0] === "object") {
      const delta = (choices[0] as { delta?: { content?: unknown } }).delta;
      if (typeof delta?.content === "string") deltaText += delta.content;
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() ?? "";
    for (const block of blocks) consumeEvent(block);
    if (done) break;
  }
  if (buffer.trim()) consumeEvent(buffer);
  return deltaText || finalText;
}

export async function completeChat(
  config: ModelConfig,
  messages: ChatMessage[],
  options?: CompleteChatOptions,
): Promise<string> {
  if (!config.baseUrl.trim() || !config.apiKey.trim() || !config.model.trim()) {
    throw new Error("模型未配置完整：需要 Base URL、API Key 和模型名");
  }

  const maxTokens = options?.maxTokens ?? 8192;
  const temperature = options?.temperature ?? 0.4;
  const protocol: LlmProtocol = config.protocol;
  let response: Response;
  reportProgress(options, { phase: "request_sent" });

  if (protocol === "chat_completions") {
    response = await fetch(joinUrl(config.baseUrl, "/v1/chat/completions"), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.model,
        temperature,
        messages,
        max_tokens: maxTokens,
        response_format: options?.jsonSchema
          ? {
              type: "json_schema",
              json_schema: {
                name: options.jsonSchema.name,
                schema: options.jsonSchema.schema,
                strict: true,
              },
            }
          : undefined,
      }),
    });
  } else if (protocol === "responses") {
    response = await fetch(joinUrl(config.baseUrl, "/v1/responses"), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.model,
        input: messages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
        max_output_tokens: maxTokens,
        temperature,
        stream: options?.stream || undefined,
        tools: options?.webSearch ? [{ type: "web_search" }] : undefined,
        max_tool_calls: options?.maxToolCalls,
        text: options?.jsonSchema
          ? {
              format: {
                type: "json_schema",
                name: options.jsonSchema.name,
                schema: options.jsonSchema.schema,
                strict: true,
              },
            }
          : undefined,
      }),
    });
  } else if (protocol === "messages") {
    const system = messages
      .filter((message) => message.role === "system")
      .map((message) => message.content)
      .join("\n\n");
    const rest = messages.filter((message) => message.role !== "system");
    response = await fetch(joinUrl(config.baseUrl, "/v1/messages"), {
      method: "POST",
      headers: {
        "x-api-key": config.apiKey,
        Authorization: `Bearer ${config.apiKey}`,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: maxTokens,
        temperature,
        system: system || undefined,
        messages: rest.map((message) => ({
          role: message.role === "assistant" ? "assistant" : "user",
          content: message.content,
        })),
      }),
    });
  } else {
    const system = messages
      .filter((message) => message.role === "system")
      .map((message) => message.content)
      .join("\n\n");
    const rest = messages.filter((message) => message.role !== "system");
    const contents = rest.map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.content }],
    }));
    const url = new URL(
      joinUrl(config.baseUrl, `/v1beta/models/${encodeURIComponent(config.model)}:generateContent`),
    );
    if (!config.baseUrl.includes("openai") && !url.searchParams.has("key")) {
      url.searchParams.set("key", config.apiKey);
    }
    response = await fetch(url.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        systemInstruction: system ? { parts: [{ text: system }] } : undefined,
        contents,
        generationConfig: { temperature, maxOutputTokens: maxTokens },
      }),
    });
  }

  if (!response.ok) {
    throw new Error(`模型请求失败 ${response.status}: ${await readError(response)}`);
  }
  reportProgress(options, { phase: "response_started" });

  const contentType = response.headers.get("content-type") || "";
  const text = (
    options?.stream && contentType.includes("text/event-stream")
      ? await readEventStreamText(response, options)
      : extractTextFromUnknown((await response.json()) as unknown)
  ).trim();
  if (!text) {
    throw new Error("模型返回为空");
  }
  reportProgress(options, { phase: "completed" });
  return text;
}

export async function listModels(config: Pick<ModelConfig, "baseUrl" | "apiKey" | "protocol">): Promise<string[]> {
  if (!config.baseUrl.trim() || !config.apiKey.trim()) {
    throw new Error("先填写 Base URL 和 API Key");
  }

  let response: Response;
  if (config.protocol === "gemini") {
    const url = new URL(joinUrl(config.baseUrl, "/v1beta/models"));
    url.searchParams.set("key", config.apiKey);
    response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${config.apiKey}` },
    });
  } else if (config.protocol === "messages") {
    response = await fetch(joinUrl(config.baseUrl, "/v1/models"), {
      headers: {
        "x-api-key": config.apiKey,
        Authorization: `Bearer ${config.apiKey}`,
        "anthropic-version": "2023-06-01",
      },
    });
  } else {
    response = await fetch(joinUrl(config.baseUrl, "/v1/models"), {
      headers: { Authorization: `Bearer ${config.apiKey}` },
    });
  }

  if (!response.ok) {
    throw new Error(`拉取模型失败 ${response.status}: ${await readError(response)}`);
  }

  const data = (await response.json()) as {
    data?: Array<{ id?: string }>;
    models?: Array<{ name?: string; id?: string }>;
  };
  const names = new Set<string>();
  for (const item of data.data ?? []) {
    if (item.id) names.add(item.id);
  }
  for (const item of data.models ?? []) {
    const raw = item.name || item.id || "";
    const cleaned = raw.replace(/^models\//, "");
    if (cleaned) names.add(cleaned);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

export function extractJsonObject(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced?.[1] ?? text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("模型输出里没有 JSON");
  }
  return JSON.parse(raw.slice(start, end + 1));
}

export function extractSvg(text: string): string {
  const match = text.match(/<svg\b[\s\S]*<\/svg>/i);
  if (!match) {
    throw new Error("模型输出里没有 SVG");
  }
  let svg = match[0].trim();
  const opening = svg.match(/^<svg\b[^>]*>/i)?.[0];
  if (!opening) throw new Error("SVG 根元素无效");

  const viewBox = readSvgAttribute(opening, "viewBox");
  if (!viewBox) {
    svg = svg.replace(/<svg\b/i, '<svg viewBox="0 0 1280 720"');
  } else if (!sameNumberList(viewBox, [0, 0, 1280, 720])) {
    throw new Error("SVG viewBox 必须是 0 0 1280 720");
  }

  const width = readSvgAttribute(opening, "width");
  if (!width) {
    svg = svg.replace(/<svg\b/i, '<svg width="1280"');
  } else if (!sameSvgLength(width, 1280)) {
    throw new Error("SVG width 必须是 1280");
  }

  const height = readSvgAttribute(opening, "height");
  if (!height) {
    svg = svg.replace(/<svg\b/i, '<svg height="720"');
  } else if (!sameSvgLength(height, 720)) {
    throw new Error("SVG height 必须是 720");
  }

  if (/<script\b/i.test(svg)) throw new Error("SVG 不允许包含 script");
  if (/<image\b[^>]*(?:href|xlink:href)\s*=\s*["']https?:/i.test(svg)) {
    throw new Error("SVG 不允许引用外部图片");
  }
  return svg;
}

function readSvgAttribute(opening: string, name: string): string | null {
  const match = opening.match(new RegExp(`\\s${name}\\s*=\\s*["']([^"']+)["']`, "i"));
  return match?.[1]?.trim() ?? null;
}

function sameNumberList(value: string, expected: number[]): boolean {
  const values = value.trim().split(/[\s,]+/).map(Number);
  return values.length === expected.length && values.every((item, index) => item === expected[index]);
}

function sameSvgLength(value: string, expected: number): boolean {
  const normalized = value.trim().replace(/px$/i, "");
  return normalized !== "" && Number(normalized) === expected;
}
