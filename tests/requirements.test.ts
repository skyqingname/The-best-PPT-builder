import assert from "node:assert/strict";
import test from "node:test";
import { parseAssumptionsJson } from "../src/lib/assumptions.ts";
import {
  ASSUMPTIONS_SYSTEM,
  BENTO_RULES,
  designSvgSystem,
  draftSvgSystem,
  ORIGINAL_CONTENT_SVG_PROMPT,
  ORIGINAL_OUTLINE_PROMPT,
  OUTLINE_SYSTEM,
} from "../src/lib/prompts.ts";
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
  assert.match(prompt, /真实 SVG 信息图/);
  assert.match(prompt, /禁止保留虚线框、空卡片/);
  assert.match(prompt, /允许在各分区内部做必要的字号微调/);
});

test("published outline and Bento prompts remain the immutable core", () => {
  assert.match(ORIGINAL_OUTLINE_PROMPT, /# Role: 顶级的PPT结构架构师/);
  assert.match(ORIGINAL_OUTLINE_PROMPT, /Core Methodology: 金字塔原理/);
  assert.match(ORIGINAL_OUTLINE_PROMPT, /\[PPT_OUTLINE\]/);
  assert.match(ORIGINAL_CONTENT_SVG_PROMPT, /作为精通信息架构与 SVG 编码的专家/);
  assert.ok(ORIGINAL_CONTENT_SVG_PROMPT.includes(BENTO_RULES));
});

test("page types receive non-conflicting layout prompts", () => {
  assert.match(draftSvgSystem("content"), /内容页的便当网格/);
  assert.doesNotMatch(draftSvgSystem("cover"), /内容页的便当网格/);
  assert.doesNotMatch(draftSvgSystem("toc"), /内容页的便当网格/);
  assert.doesNotMatch(draftSvgSystem("section"), /内容页的便当网格/);
  assert.doesNotMatch(draftSvgSystem("end"), /内容页的便当网格/);
  assert.match(draftSvgSystem("cover"), /PRESENTED BY/);
  assert.match(designSvgSystem(getStylePack("brand-clean"), "content"), /内容页的便当网格/);
  assert.doesNotMatch(designSvgSystem(getStylePack("brand-clean"), "section"), /内容页的便当网格/);
});

test("outline prompt rejects filler instead of propagating placeholders", () => {
  assert.match(OUTLINE_SYSTEM, /结论先行的页面观点/);
  assert.match(OUTLINE_SYSTEM, /禁止输出“待补充”“待核实”/);
  assert.match(OUTLINE_SYSTEM, /公开资料不足时缩小页面论证范围/);
});
