import type { LlmProtocol, ModelConfig } from "./types";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
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
  const text = await response.text();
  return text.slice(0, 800) || response.statusText;
}

export async function completeChat(
  config: ModelConfig,
  messages: ChatMessage[],
  options?: { maxTokens?: number; temperature?: number },
): Promise<string> {
  if (!config.baseUrl.trim() || !config.apiKey.trim() || !config.model.trim()) {
    throw new Error("模型未配置完整：需要 Base URL、API Key 和模型名");
  }

  const maxTokens = options?.maxTokens ?? 8192;
  const temperature = options?.temperature ?? 0.4;
  const protocol: LlmProtocol = config.protocol;
  let response: Response;

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
      }),
    });
  } else if (protocol === "responses") {
    const input = messages
      .map((message) => `${message.role.toUpperCase()}:\n${message.content}`)
      .join("\n\n");
    response = await fetch(joinUrl(config.baseUrl, "/v1/responses"), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.model,
        input,
        temperature,
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

  const data = (await response.json()) as unknown;
  const text = extractTextFromUnknown(data).trim();
  if (!text) {
    throw new Error("模型返回为空");
  }
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
  if (!/viewBox=/i.test(svg)) {
    svg = svg.replace(/<svg\b/i, '<svg viewBox="0 0 1280 720"');
  }
  if (!/\bwidth=/i.test(svg)) {
    svg = svg.replace(/<svg\b/i, '<svg width="1280"');
  }
  if (!/\bheight=/i.test(svg)) {
    svg = svg.replace(/<svg\b/i, '<svg height="720"');
  }
  return svg;
}
