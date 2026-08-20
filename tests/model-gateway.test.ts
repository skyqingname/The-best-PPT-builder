import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { generateSvg, generateText } from "../src/lib/model-gateway.ts";
import type { ModelConfig } from "../src/lib/types.ts";

const config: ModelConfig = {
  baseUrl: "https://gateway.example",
  apiKey: "test-key",
  protocol: "chat_completions",
  model: "test-model",
};

afterEach(() => mock.restoreAll());

test("model gateway retries a transient generation failure", async () => {
  let calls = 0;
  mock.method(globalThis, "fetch", async () => {
    calls += 1;
    if (calls === 1) {
      return new Response(JSON.stringify({ error: { message: "model at capacity" } }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ choices: [{ message: { content: "ready" } }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });

  const result = await generateText(config, [{ role: "user", content: "hello" }], {
    retryDelaysMs: [0],
  });

  assert.equal(result, "ready");
  assert.equal(calls, 2);
});

test("model gateway does not start a request after cancellation", async () => {
  const controller = new AbortController();
  controller.abort();
  let called = false;
  mock.method(globalThis, "fetch", async () => {
    called = true;
    return new Response();
  });

  await assert.rejects(
    generateText(config, [{ role: "user", content: "hello" }], {
      signal: controller.signal,
    }),
    /CANCELLED/,
  );
  assert.equal(called, false);
});

test("SVG generation repairs one invalid model output", async () => {
  let calls = 0;
  mock.method(globalThis, "fetch", async () => {
    calls += 1;
    const content = calls === 1
      ? '<svg viewBox="0 0 1280 720" width="1280" height="720"><text>内容待补充</text></svg>'
      : '<svg viewBox="0 0 1280 720" width="1280" height="720"><rect width="1280" height="720" fill="#f5f7fa"/><text x="80" y="120" font-size="60" fill="#111827">可信内容</text></svg>';
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });

  const svg = await generateSvg(config, [{ role: "user", content: "make a slide" }]);

  assert.match(svg, /可信内容/);
  assert.equal(calls, 2);
});
