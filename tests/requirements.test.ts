import assert from "node:assert/strict";
import test from "node:test";
import { parseAssumptionsJson } from "../src/lib/assumptions.ts";
import { ASSUMPTIONS_SYSTEM, designSvgSystem } from "../src/lib/prompts.ts";
import { getStylePack } from "../src/lib/styles.ts";

test("legacy assumptions remain readable when question options are absent", () => {
  const parsed = parseAssumptionsJson(
    JSON.stringify({
      pageCount: 10,
      audience: "管理层",
      purpose: "决策",
      styleId: "brand-clean",
      questions: [{ id: "q1", label: "受众", value: "管理层", reason: "主题判断" }],
    }),
    { pageCount: 12, styleId: "brand-clean" },
  );
  assert.equal(parsed.pageCount, 10);
  assert.deepEqual(parsed.questions[0]?.options, []);
});

test("requirements prompt asks for mutually exclusive selectable options", () => {
  assert.match(ASSUMPTIONS_SYSTEM, /2 到 3 个简短、互斥/);
  assert.match(ASSUMPTIONS_SYSTEM, /value 必须等于其中一个 option/);
});

test("design prompt requires replacing wireframes with real SVG visuals", () => {
  const prompt = designSvgSystem(getStylePack("brand-clean"));
  assert.match(prompt, /不能只做换色/);
  assert.match(prompt, /实现为真实 SVG 图表/);
  assert.match(prompt, /不得保留虚线空框和占位文案/);
});
