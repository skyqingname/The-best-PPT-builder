import type { SearchHit, SearchProvider } from "./types";

async function searchTavily(apiKey: string, query: string): Promise<SearchHit[]> {
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: "advanced",
      include_raw_content: true,
      max_results: 5,
    }),
  });
  if (!response.ok) {
    throw new Error(`Tavily 搜索失败 ${response.status}`);
  }
  const data = (await response.json()) as {
    results?: Array<{
      title?: string;
      url?: string;
      content?: string;
      raw_content?: string;
    }>;
  };
  return (data.results ?? []).map((item) => ({
    title: item.title || item.url || "untitled",
    url: item.url || "",
    snippet: item.content || "",
    content: item.raw_content || item.content || "",
  }));
}

async function searchBocha(apiKey: string, query: string): Promise<SearchHit[]> {
  const response = await fetch("https://api.bochaai.com/v1/web-search", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      freshness: "noLimit",
      summary: true,
      count: 5,
    }),
  });
  if (!response.ok) {
    throw new Error(`博查搜索失败 ${response.status}`);
  }
  const data = (await response.json()) as {
    data?: {
      webPages?: {
        value?: Array<{
          name?: string;
          url?: string;
          snippet?: string;
          summary?: string;
        }>;
      };
    };
    webPages?: {
      value?: Array<{
        name?: string;
        url?: string;
        snippet?: string;
        summary?: string;
      }>;
    };
  };
  const values = data.data?.webPages?.value ?? data.webPages?.value ?? [];
  return values.map((item) => ({
    title: item.name || item.url || "untitled",
    url: item.url || "",
    snippet: item.snippet || item.summary || "",
    content: item.summary || item.snippet || "",
  }));
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
  provider: SearchProvider,
  apiKey: string,
  query: string,
): Promise<SearchHit[]> {
  if (!apiKey.trim()) {
    throw new Error("未配置搜索 API Key");
  }
  const hits =
    provider === "bocha" ? await searchBocha(apiKey, query) : await searchTavily(apiKey, query);
  const hydrated: SearchHit[] = [];
  for (const hit of hits.slice(0, 5)) {
    hydrated.push(await hydrateHit(hit));
  }
  return hydrated;
}

export function compactHits(hits: SearchHit[], limit = 6): SearchHit[] {
  return hits.slice(0, limit).map((hit) => ({
    ...hit,
    content: hit.content.slice(0, 1800),
    snippet: hit.snippet.slice(0, 400),
  }));
}
