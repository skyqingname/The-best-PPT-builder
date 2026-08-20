import { extractJsonObject } from "./llm.ts";
import type { OutlinePage, PageType, PptOutline } from "./types.ts";

export function parseOutline(text: string): PptOutline {
  const boxed = text.match(/\[PPT_OUTLINE\]([\s\S]*?)\[\/PPT_OUTLINE\]/);
  const payload = boxed?.[1] ?? text;
  const parsed = extractJsonObject(payload) as {
    ppt_outline?: PptOutline;
    cover?: PptOutline["cover"];
  };
  const outline = parsed.ppt_outline ?? (parsed as PptOutline);
  if (!outline.cover?.title || !Array.isArray(outline.parts)) {
    throw new Error("大纲 JSON 不完整");
  }
  return {
    cover: {
      title: outline.cover.title,
      sub_title: outline.cover.sub_title || "",
      content: outline.cover.content || [],
    },
    table_of_contents: {
      title: outline.table_of_contents?.title || "目录",
      content: outline.table_of_contents?.content || outline.parts.map((part) => part.part_title),
    },
    parts: outline.parts.map((part) => ({
      part_title: part.part_title,
      pages: (part.pages || []).map((page) => ({
        title: page.title,
        content: Array.isArray(page.content) ? page.content : [],
      })),
    })),
    end_page: {
      title: outline.end_page?.title || "总结与展望",
      content: outline.end_page?.content || [],
    },
  };
}

export interface FlattenedPage {
  pageType: PageType;
  sectionTitle: string | null;
  title: string;
  bullets: string[];
}

export function flattenOutline(outline: PptOutline): FlattenedPage[] {
  const pages: FlattenedPage[] = [
    {
      pageType: "cover",
      sectionTitle: null,
      title: outline.cover.title,
      bullets: [outline.cover.sub_title, ...outline.cover.content].filter(Boolean),
    },
    {
      pageType: "toc",
      sectionTitle: null,
      title: outline.table_of_contents.title,
      bullets: outline.table_of_contents.content,
    },
  ];
  for (const part of outline.parts) {
    pages.push({
      pageType: "section",
      sectionTitle: part.part_title,
      title: part.part_title,
      bullets: [],
    });
    for (const page of part.pages) {
      pages.push({
        pageType: "content",
        sectionTitle: part.part_title,
        title: page.title,
        bullets: page.content,
      });
    }
  }
  pages.push({
    pageType: "end",
    sectionTitle: null,
    title: outline.end_page.title,
    bullets: outline.end_page.content,
  });
  return pages;
}

export function pagesToOutline(input: Array<{
  pageType: PageType;
  sectionTitle: string | null;
  title: string;
  bullets: string[];
}>): PptOutline {
  const cover = input.find((page) => page.pageType === "cover");
  const toc = input.find((page) => page.pageType === "toc");
  const end = [...input].reverse().find((page) => page.pageType === "end");
  if (!cover || !toc || !end) throw new Error("结构必须包含封面、目录和结束页");

  const parts: PptOutline["parts"] = [];
  let active: PptOutline["parts"][number] | null = null;
  for (const page of input) {
    if (page.pageType === "section") {
      active = { part_title: page.title, pages: [] };
      parts.push(active);
      continue;
    }
    if (page.pageType !== "content") continue;
    const sectionTitle = page.sectionTitle || active?.part_title || "核心内容";
    if (!active || active.part_title !== sectionTitle) {
      active = { part_title: sectionTitle, pages: [] };
      parts.push(active);
    }
    active.pages.push({ title: page.title, content: page.bullets });
  }
  if (!parts.length) throw new Error("结构至少需要一个章节和内容页");

  return {
    cover: {
      title: cover.title,
      sub_title: cover.bullets[0] || "",
      content: cover.bullets.slice(1),
    },
    table_of_contents: {
      title: toc.title,
      content: parts.map((part) => part.part_title),
    },
    parts,
    end_page: { title: end.title, content: end.bullets },
  };
}

export function pageCode(index: number): string {
  return `page-${String(index + 1).padStart(2, "0")}`;
}

export function asOutlinePage(title: string, bullets: string[]): OutlinePage {
  return { title, content: bullets };
}
