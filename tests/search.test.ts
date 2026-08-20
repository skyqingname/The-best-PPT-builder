import assert from "node:assert/strict";
import test from "node:test";
import { parseSearchResponse, webSearch } from "../src/lib/search.ts";

test("search response parser accepts common model result shapes", () => {
  assert.deepEqual(
    parseSearchResponse({
      results: [{ title: "Search result", url: "https://a.example", content: "snippet" }],
    }),
    [{
      title: "Search result",
      url: "https://a.example",
      snippet: "snippet",
      content: "snippet",
    }],
  );
  assert.deepEqual(
    parseSearchResponse({
      data: {
        webPages: {
          value: [{ name: "Bocha result", url: "https://b.example", summary: "summary" }],
        },
      },
    }),
    [{
      title: "Bocha result",
      url: "https://b.example",
      snippet: "summary",
      content: "summary",
    }],
  );
});

test("webSearch uses the configured search model protocol and model name", async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";
  let authorization = "";
  let requestedBody: Record<string, unknown> = {};
  globalThis.fetch = async (input, init) => {
    requestedUrl = String(input);
    authorization = new Headers(init?.headers).get("authorization") || "";
    requestedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            results: [{
              title: "Result",
              url: "https://result.example",
              content: "x".repeat(500),
            }],
          }),
        },
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const results = await webSearch({
      baseUrl: "https://search-model.example",
      apiKey: "secret-key",
      protocol: "chat_completions",
      model: "online-search-model",
    }, "query");
    assert.equal(requestedUrl, "https://search-model.example/v1/chat/completions");
    assert.equal(authorization, "Bearer secret-key");
    assert.equal(requestedBody.model, "online-search-model");
    assert.equal(requestedBody.temperature, 0.1);
    assert.deepEqual(
      (requestedBody.response_format as { type?: string })?.type,
      "json_schema",
    );
    assert.equal(results.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Grok search requires Responses instead of prompt-only Chat Completions", async () => {
  await assert.rejects(
    () => webSearch({
      baseUrl: "https://api.x.ai/v1",
      apiKey: "secret-key",
      protocol: "chat_completions",
      model: "grok-4.6",
    }, "query"),
    /Grok 联网搜索需要把搜索模型协议改为 OpenAI Responses/,
  );
});

test("Responses search enables web_search and strict source schema", async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";
  let requestedBody: Record<string, unknown> = {};
  globalThis.fetch = async (input, init) => {
    requestedUrl = String(input);
    requestedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({
      output_text: JSON.stringify({
        results: [{
          title: "Result",
          url: "https://result.example",
          snippet: "snippet",
          content: "x".repeat(500),
        }],
      }),
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const results = await webSearch({
      baseUrl: "https://search-model.example/v1",
      apiKey: "secret-key",
      protocol: "responses",
      model: "grok-4.6",
    }, "query");
    assert.equal(requestedUrl, "https://search-model.example/v1/responses");
    assert.deepEqual(requestedBody.tools, [{ type: "web_search" }]);
    assert.equal(requestedBody.stream, true);
    assert.equal(requestedBody.max_output_tokens, 2048);
    assert.equal(requestedBody.max_tool_calls, 3);
    assert.equal(
      ((requestedBody.text as { format?: { type?: string } })?.format)?.type,
      "json_schema",
    );
    assert.equal(results.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Responses search retries a temporary capacity error", async () => {
  const originalFetch = globalThis.fetch;
  let requestCount = 0;
  const progress: Array<{ phase: string; attempt?: number; delayMs?: number }> = [];
  globalThis.fetch = async () => {
    requestCount += 1;
    if (requestCount === 1) {
      return new Response(
        `data: ${JSON.stringify({
          type: "error",
          error: { message: "The model is currently at capacity due to high demand." },
        })}\n\n`,
        { status: 200, headers: { "Content-Type": "text/event-stream" } },
      );
    }
    return new Response(JSON.stringify({
      output_text: JSON.stringify({
        results: [{
          title: "Recovered result",
          url: "https://result.example",
          snippet: "snippet",
          content: "x".repeat(500),
        }],
      }),
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const results = await webSearch({
      baseUrl: "https://search-model.example/v1",
      apiKey: "secret-key",
      protocol: "responses",
      model: "grok-4.6",
    }, "query", {
      retryDelaysMs: [0],
      onProgress: (update) => progress.push(update),
    });
    assert.equal(requestCount, 2);
    assert.equal(results[0]?.title, "Recovered result");
    assert.deepEqual(
      progress.filter((update) => update.phase === "retrying"),
      [{
        phase: "retrying",
        attempt: 2,
        maxAttempts: 2,
        delayMs: 0,
        message: "The model is currently at capacity due to high demand.",
      }],
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Responses search retry wait can be cancelled", async () => {
  const originalFetch = globalThis.fetch;
  let cancelled = false;
  let requestCount = 0;
  globalThis.fetch = async () => {
    requestCount += 1;
    return new Response(
      `data: ${JSON.stringify({
        type: "error",
        error: { message: "The model is currently at capacity due to high demand." },
      })}\n\n`,
      { status: 200, headers: { "Content-Type": "text/event-stream" } },
    );
  };
  try {
    await assert.rejects(
      () => webSearch({
        baseUrl: "https://search-model.example/v1",
        apiKey: "secret-key",
        protocol: "responses",
        model: "grok-4.6",
      }, "query", {
        retryDelaysMs: [1_000],
        shouldCancel: () => cancelled,
        onProgress: (update) => {
          if (update.phase === "retrying") cancelled = true;
        },
      }),
      /CANCELLED/,
    );
    assert.equal(requestCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
