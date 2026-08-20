import assert from "node:assert/strict";
import test from "node:test";
import { flattenOutline, pagesToOutline } from "../src/lib/outline.ts";
import type { PptOutline } from "../src/lib/types.ts";

const outline: PptOutline = {
  cover: { title: "主题", sub_title: "副标题", content: ["版本说明"] },
  table_of_contents: { title: "目录", content: ["第一部分", "第二部分"] },
  parts: [
    {
      part_title: "第一部分",
      pages: [{ title: "第一页", content: ["观点 A"] }],
    },
    {
      part_title: "第二部分",
      pages: [{ title: "第二页", content: ["观点 B"] }],
    },
  ],
  end_page: { title: "结束", content: ["行动建议"] },
};

test("outline materializes one section page per part", () => {
  const pages = flattenOutline(outline);
  assert.deepEqual(
    pages.map((page) => page.pageType),
    ["cover", "toc", "section", "content", "section", "content", "end"],
  );
  assert.equal(pages[2]?.title, "第一部分");
  assert.equal(pages[4]?.title, "第二部分");
});

test("materialized pages round-trip into the original outline contract", () => {
  const rebuilt = pagesToOutline(flattenOutline(outline));
  assert.deepEqual(rebuilt, outline);
});
