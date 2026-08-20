import { completeChat, extractJsonObject } from "./llm.ts";
import type { LlmProgressUpdate } from "./llm.ts";
import { SEARCH_MODEL_SYSTEM } from "./prompts.ts";
import type { ModelConfig, SearchHit } from "./types.ts";

type JsonRecord = Record<string, unknown>;

const SEARCH_RETRY_DELAYS_MS = [5_000, 15_000, 30_000, 45_000];

interface WebSearchOptions {
  onProgress?: (update: LlmProgressUpdate) => void;
  shouldCancel?: () => boolean;
  retryDelaysMs?: number[];
}

export const SEARCH_RESULTS_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    results: {
      type: "array",
      maxItems: 5,
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          url: { type: "string" },
          snippet: { type: "string" },
          content: { type: "string" },
        },
        required: ["title", "url", "snippet", "content"],
        additionalProperties: false,
      },
    },
  },
  required: ["results"],
  additionalProperties: false,
};

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function firstString(record: JsonRecord, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

export function parseSearchResponse(payload: unknown): SearchHit[] {
  const root = asRecord(payload);
  const data = asRecord(root.data);
  const rootWebPages = asRecord(root.webPages);
  const dataWebPages = asRecord(data.webPages);
  const candidates = [
    root.results,
    data.results,
    dataWebPages.value,
    rootWebPages.value,
    root.items,
    data.items,
    root.search_result,
    Array.isArray(root.data) ? root.data : undefined,
  ];
  const list = candidates.find(Array.isArray) as unknown[] | undefined;
  return (list ?? [])
    .map((value) => {
      const item = asRecord(value);
      const title = firstString(item, ["title", "name"]);
      const url = firstString(item, ["url", "link"]);
      const snippet = firstString(item, ["snippet", "summary", "content"]);
      const content = firstString(item, [
        "raw_content",
        "rawContent",
        "summary",
        "content",
        "snippet",
      ]);
      return {
        title: title || url || "untitled",
        url,
        snippet,
        content,
      };
    })
    .filter((item) => item.url || item.title !== "untitled");
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function hydrateHit(hit: SearchHit): Promise<SearchHit> {
  if (hit.content.trim().length >= 400 || !hit.url.startsWith("http")) {
    return hit;
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(hit.url, {
      signal: controller.signal,
      headers: { "User-Agent": "ppt-agent/0.1" },
    });
    clearTimeout(timer);
    if (!response.ok) return hit;
    const html = await response.text();
    const text = stripHtml(html).slice(0, 6000);
    if (text.length < 80) return hit;
    return { ...hit, content: text };
  } catch {
    return hit;
  }
}

export async function webSearch(
  config: ModelConfig,
  query: string,
  options?: WebSearchOptions,
): Promise<SearchHit[]> {
  if (/grok/i.test(config.model) && config.protocol !== "responses") {
    throw new Error("Grok 联网搜索需要把搜索模型协议改为 OpenAI Responses");
  }
  const retryDelaysMs = options?.retryDelaysMs ?? SEARCH_RETRY_DELAYS_MS;
  const maxAttempts = retryDelaysMs.length + 1;
  let raw = "";
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (options?.shouldCancel?.()) throw new Error("CANCELLED");
    try {
      raw = await completeChat(
        config,
        [
          { role: "system", content: SEARCH_MODEL_SYSTEM },
          { role: "user", content: query },
        ],
        {
          maxTokens: 2048,
          temperature: 0.1,
          webSearch: config.protocol === "responses",
          stream: config.protocol === "responses",
          maxToolCalls: config.protocol === "responses" ? 3 : undefined,
          onProgress: options?.onProgress,
          jsonSchema: { name: "search_results", schema: SEARCH_RESULTS_SCHEMA },
        },
      );
      break;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (!isRetryableSearchError(message) || attempt >= maxAttempts) throw error;
      const delayMs = retryDelaysMs[attempt - 1];
      try {
        options?.onProgress?.({
          phase: "retrying",
          attempt: attempt + 1,
          maxAttempts,
          delayMs,
          message,
        });
      } catch {
        // Retry progress must not change search behavior.
      }
      await waitForRetry(delayMs, options?.shouldCancel);
    }
  }
  let hits: SearchHit[];
  try {
    hits = parseSearchResponse(extractJsonObject(raw));
  } catch {
    throw new Error("搜索模型没有返回可解析的来源 JSON");
  }
  const hydrated: SearchHit[] = [];
  for (const hit of hits.slice(0, 5)) {
    hydrated.push(await hydrateHit(hit));
  }
  return hydrated;
}

function isRetryableSearchError(message: string): boolean {
  return /\b(?:429|502|503|504|524)\b|at capacity|high demand|rate[ -]?limit|temporar(?:y|ily) unavailable|overloaded|timed?\s*out|容量|限流|繁忙|暂时不可用|超时/i.test(message);
}

async function waitForRetry(delayMs: number, shouldCancel?: () => boolean): Promise<void> {
  const deadline = Date.now() + Math.max(0, delayMs);
  while (Date.now() < deadline) {
    if (shouldCancel?.()) throw new Error("CANCELLED");
    const remaining = deadline - Date.now();
    await new Promise((resolve) => setTimeout(resolve, Math.min(250, remaining)));
  }
  if (shouldCancel?.()) throw new Error("CANCELLED");
}

export function compactHits(hits: SearchHit[], limit = 6): SearchHit[] {
  return hits.slice(0, limit).map((hit) => ({
    ...hit,
    content: hit.content.slice(0, 1800),
    snippet: hit.snippet.slice(0, 400),
  }));
}
