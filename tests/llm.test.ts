import assert from "node:assert/strict";
import test from "node:test";
import { completeChat, extractSvg } from "../src/lib/llm.ts";

test("Responses sends structured roles and max_output_tokens", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: Record<string, unknown> | undefined;
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({ output_text: "done" }), { status: 200 });
  };
  try {
    const result = await completeChat(
      {
        baseUrl: "https://api.openai.com",
        apiKey: "test-key",
        protocol: "responses",
        model: "test-model",
      },
      [
        { role: "system", content: "system rule" },
        { role: "user", content: "user request" },
      ],
      { maxTokens: 12000 },
    );
    assert.equal(result, "done");
    assert.equal(requestBody?.max_output_tokens, 12000);
    assert.deepEqual(requestBody?.input, [
      { role: "system", content: "system rule" },
      { role: "user", content: "user request" },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Responses joins SSE output text deltas", async () => {
  const originalFetch = globalThis.fetch;
  const phases: string[] = [];
  const events = [
    { type: "response.created", response: { id: "response-id" } },
    { type: "response.web_search_call.in_progress", item_id: "search-id" },
    { type: "response.output_text.delta", delta: '{"results":' },
    { type: "response.output_text.delta", delta: "[]}" },
    {
      type: "response.completed",
      response: { output_text: '{"results":[]}' },
    },
  ];
  globalThis.fetch = async () => new Response(
    `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")}data: [DONE]\n\n`,
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  );
  try {
    const result = await completeChat(
      {
        baseUrl: "https://api.x.ai",
        apiKey: "test-key",
        protocol: "responses",
        model: "grok-test",
      },
      [{ role: "user", content: "search" }],
      {
        stream: true,
        webSearch: true,
        onProgress: (update) => phases.push(update.phase),
      },
    );
    assert.equal(result, '{"results":[]}');
    assert.deepEqual(phases, [
      "request_sent",
      "response_started",
      "tool_running",
      "output_streaming",
      "completed",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("model gateway HTML errors are reduced to a readable 524 message", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(
    "<!DOCTYPE html><html><title>gateway timeout</title></html>",
    { status: 524, headers: { "Content-Type": "text/html" } },
  );
  try {
    await assert.rejects(
      () => completeChat(
        {
          baseUrl: "https://gateway.example",
          apiKey: "test-key",
          protocol: "responses",
          model: "grok-test",
        },
        [{ role: "user", content: "search" }],
      ),
      (error: unknown) => {
        assert.match(String(error), /模型请求失败 524: 上游网关等待模型超时/);
        assert.doesNotMatch(String(error), /DOCTYPE/);
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("extractSvg fills missing 1280x720 attributes", () => {
  const svg = extractSvg('<svg xmlns="http://www.w3.org/2000/svg"><rect width="1280" height="720" fill="#f5f7fa"/><text x="80" y="120" font-size="60">页面标题</text></svg>');
  assert.match(svg, /viewBox="0 0 1280 720"/);
  assert.match(svg, /width="1280"/);
  assert.match(svg, /height="720"/);
});

test("extractSvg rejects a wrong canvas", () => {
  assert.throws(
    () => extractSvg('<svg viewBox="0 0 1024 768" width="1024" height="768"></svg>'),
    /viewBox 必须是 0 0 1280 720/,
  );
});

test("extractSvg rejects unsafe or unfinished slide content", () => {
  assert.throws(
    () => extractSvg('<svg viewBox="0 0 1280 720" width="1280" height="720"><script /></svg>'),
    /不允许包含 script/,
  );
  assert.throws(
    () => extractSvg('<svg viewBox="0 0 1280 720" width="1280" height="720"><foreignObject /></svg>'),
    /不允许包含 foreignObject/,
  );
  assert.throws(
    () => extractSvg('<svg viewBox="0 0 1280 720" width="1280" height="720"><image href="https://example.com/a.png" /></svg>'),
    /不允许引用外部图片/,
  );
  assert.throws(
    () => extractSvg('<svg viewBox="0 0 1280 720" width="1280" height="720"><text>公司信息待补充</text></svg>'),
    /未完成的占位文案/,
  );
  assert.throws(
    () => extractSvg('<svg viewBox="0 0 1280 720" width="1280" height="720"><text>PRESENTED BY</text></svg>'),
    /输入之外的模板元数据/,
  );
});

test("extractSvg recovers the real root after model reasoning mentions an SVG tag", () => {
  const output = `<svg height="720" width="1280" viewBox="0 0 1280 720">thinking about Business & Design
<svg viewBox="0 0 1280 720" width="1280" height="720"><rect width="1280" height="720" fill="#f5f7fa"/><text x="80" y="120" font-size="60">真实设计稿</text></svg>`;
  const svg = extractSvg(output);
  assert.equal((svg.match(/<svg\b/gi) ?? []).length, 1);
  assert.match(svg, /真实设计稿/);
  assert.doesNotMatch(svg, /thinking about/);
});

test("extractSvg rejects malformed XML and visually blank slides", () => {
  assert.throws(
    () => extractSvg('<svg viewBox="0 0 1280 720" width="1280" height="720"><text>A & B</text></svg>'),
    /无法解析或渲染/,
  );
  assert.throws(
    () => extractSvg('<svg viewBox="0 0 1280 720" width="1280" height="720"><rect width="1280" height="720" fill="white"/><text fill="white">不可见标题</text></svg>'),
    /渲染结果为空白/,
  );
});
