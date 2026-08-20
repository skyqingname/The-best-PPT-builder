import { Resvg } from "@resvg/resvg-js";
import type { LlmProtocol, ModelConfig } from "./types";

export type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: "image/jpeg" | "image/png" | "image/webp" };

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string | ChatContentPart[];
}

const svgExtractionCache = new Map<string, string>();
const SVG_EXTRACTION_CACHE_LIMIT = 128;

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
  signal?: AbortSignal;
  timeoutMs?: number;
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

function messageText(message: ChatMessage): string {
  return typeof message.content === "string"
    ? message.content
    : message.content
        .filter((part): part is Extract<ChatContentPart, { type: "text" }> => part.type === "text")
        .map((part) => part.text)
        .join("\n");
}

function chatCompletionsContent(content: ChatMessage["content"]): unknown {
  if (typeof content === "string") return content;
  return content.map((part) => part.type === "text"
    ? { type: "text", text: part.text }
    : {
        type: "image_url",
        image_url: { url: `data:${part.mimeType};base64,${part.data}` },
      });
}

function responsesContent(content: ChatMessage["content"]): unknown {
  if (typeof content === "string") return content;
  return content.map((part) => part.type === "text"
    ? { type: "input_text", text: part.text }
    : { type: "input_image", image_url: `data:${part.mimeType};base64,${part.data}` });
}

function messagesContent(content: ChatMessage["content"]): unknown {
  if (typeof content === "string") return content;
  return content.map((part) => part.type === "text"
    ? { type: "text", text: part.text }
    : {
        type: "image",
        source: { type: "base64", media_type: part.mimeType, data: part.data },
      });
}

function geminiParts(content: ChatMessage["content"]): unknown[] {
  if (typeof content === "string") return [{ text: content }];
  return content.map((part) => part.type === "text"
    ? { text: part.text }
    : { inlineData: { mimeType: part.mimeType, data: part.data } });
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
  const timeoutSignal = AbortSignal.timeout(options?.timeoutMs ?? 180_000);
  const signal = options?.signal
    ? AbortSignal.any([options.signal, timeoutSignal])
    : timeoutSignal;
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
        messages: messages.map((message) => ({
          role: message.role,
          content: chatCompletionsContent(message.content),
        })),
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
      signal,
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
          content: responsesContent(message.content),
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
      signal,
    });
  } else if (protocol === "messages") {
    const system = messages
      .filter((message) => message.role === "system")
      .map(messageText)
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
          content: messagesContent(message.content),
        })),
      }),
      signal,
    });
  } else {
    const system = messages
      .filter((message) => message.role === "system")
      .map(messageText)
      .join("\n\n");
    const rest = messages.filter((message) => message.role !== "system");
    const contents = rest.map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: geminiParts(message.content),
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
      signal,
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
      signal: AbortSignal.timeout(30_000),
    });
  } else if (config.protocol === "messages") {
    response = await fetch(joinUrl(config.baseUrl, "/v1/models"), {
      headers: {
        "x-api-key": config.apiKey,
        Authorization: `Bearer ${config.apiKey}`,
        "anthropic-version": "2023-06-01",
      },
      signal: AbortSignal.timeout(30_000),
    });
  } else {
    response = await fetch(joinUrl(config.baseUrl, "/v1/models"), {
      headers: { Authorization: `Bearer ${config.apiKey}` },
      signal: AbortSignal.timeout(30_000),
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
  const cached = svgExtractionCache.get(text);
  if (cached) return cached;
  const candidates = collectSvgCandidates(text);
  if (candidates.length === 0) {
    throw new Error("模型输出里没有完整 SVG");
  }

  let firstError: unknown;
  for (const candidate of candidates) {
    try {
      const svg = validateSvgCandidate(candidate);
      svgExtractionCache.set(text, svg);
      while (svgExtractionCache.size > SVG_EXTRACTION_CACHE_LIMIT) {
        const oldest = svgExtractionCache.keys().next().value;
        if (typeof oldest !== "string") break;
        svgExtractionCache.delete(oldest);
      }
      return svg;
    } catch (error) {
      firstError ??= error;
    }
  }
  throw firstError instanceof Error ? firstError : new Error("模型输出里没有可渲染 SVG");
}

function collectSvgCandidates(text: string): string[] {
  const sources: string[] = [];
  const fenced = text.matchAll(/```(?:svg|xml)?\s*([\s\S]*?)```/gi);
  for (const match of fenced) sources.push(match[1] ?? "");
  sources.push(text);

  const candidates: string[] = [];
  const seen = new Set<string>();
  for (const source of sources) {
    const starts = [...source.matchAll(/<svg\b/gi)]
      .map((match) => match.index)
      .filter((index): index is number => typeof index === "number");
    for (const start of starts.reverse()) {
      const closeStart = source.indexOf("</svg>", start);
      if (closeStart < 0) continue;
      const candidate = source.slice(start, closeStart + "</svg>".length).trim();
      if (!seen.has(candidate)) {
        seen.add(candidate);
        candidates.push(candidate);
      }
    }
  }
  return candidates;
}

function validateSvgCandidate(input: string): string {
  let svg = input.trim();
  const opening = svg.match(/^<svg\b[^>]*>/i)?.[0];
  if (!opening) throw new Error("SVG 根元素无效");
  if ((svg.match(/<svg\b/gi) ?? []).length !== 1 || !/<\/svg>\s*$/i.test(svg)) {
    throw new Error("SVG 必须只有一个完整根节点");
  }

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

  if (!readSvgAttribute(opening, "xmlns")) {
    svg = svg.replace(/<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  }

  if (/<script\b/i.test(svg)) throw new Error("SVG 不允许包含 script");
  if (/<foreignObject\b/i.test(svg)) throw new Error("SVG 不允许包含 foreignObject");
  if (/<image\b[^>]*(?:href|xlink:href)\s*=\s*["']https?:/i.test(svg)) {
    throw new Error("SVG 不允许引用外部图片");
  }
  if (/待补充|待核实|占位|示意图区域|图表区域|预览|lorem\s+ipsum/i.test(svg)) {
    throw new Error("SVG 包含未完成的占位文案");
  }
  if (/PRESENTED\s+BY|BUSINESS\s+PRESENTATION\s+PROPOSAL|STRICTLY\s+CONFIDENTIAL|STATUS:\s*PLANNING\s+DRAFT|CORE\s+PRINCIPLES|DOCUMENT\s+TYPE|DATE\s*&\s*EDITION|\b20\d{2}\s+EDITION\b/i.test(svg)) {
    throw new Error("SVG 包含输入之外的模板元数据");
  }

  const visibleText = svg
    .replace(/<defs\b[\s\S]*?<\/defs>/gi, " ")
    .match(/<text\b[^>]*>[\s\S]*?<\/text>/gi)
    ?.join(" ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(?:#\d+|#x[\da-f]+|[a-z][\w.-]*);/gi, " ")
    .replace(/\s+/g, " ")
    .trim() ?? "";
  if (visibleText.length < 2) {
    throw new Error("SVG 没有可见文字内容");
  }

  assertSvgRenders(svg, hasLikelyVisibleText(svg));
  return svg;
}

function hasLikelyVisibleText(svg: string): boolean {
  return (svg.match(/<text\b[^>]*>[\s\S]*?<\/text>/gi) ?? []).some((element) => {
    const opening = element.match(/^<text\b[^>]*>/i)?.[0] ?? "";
    if (/\b(?:display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?:\D|$))/i.test(opening)) {
      return false;
    }
    const fill = readSvgAttribute(opening, "fill")
      ?? opening.match(/\bfill\s*:\s*([^;"']+)/i)?.[1]?.trim()
      ?? "black";
    if (/^(?:none|transparent|white|#fff(?:fff)?|rgb\(\s*255\s*,\s*255\s*,\s*255\s*\))$/i.test(fill)) {
      return false;
    }
    const content = element.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (!content) return false;
    const fontSize = readSvgAttribute(opening, "font-size")
      ?? opening.match(/\bfont-size\s*:\s*([\d.]+)/i)?.[1];
    return !fontSize || Number.parseFloat(fontSize) >= 8;
  });
}

function assertSvgRenders(svg: string, hasVisibleText: boolean): void {
  try {
    const renderer = new Resvg(svg, {
      fitTo: { mode: "width", value: 320 },
      font: { loadSystemFonts: false },
      background: "white",
      logLevel: "off",
    });
    const image = renderer.render();
    const pixels = image.pixels;
    let inkPixels = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      const distanceFromWhite =
        255 - pixels[index] + 255 - pixels[index + 1] + 255 - pixels[index + 2];
      if (distanceFromWhite > 36) inkPixels += 1;
    }
    const minimumInk = Math.max(64, Math.floor(image.width * image.height * 0.001));
    if (inkPixels < minimumInk && !hasVisibleText) {
      throw new Error("SVG 渲染结果为空白");
    }
  } catch (error) {
    if (error instanceof Error && error.message === "SVG 渲染结果为空白") throw error;
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`SVG 无法解析或渲染：${detail.replace(/\s+/g, " ").slice(0, 240)}`);
  }
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
