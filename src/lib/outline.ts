import { extractJsonObject } from "./llm";
import type { OutlinePage, PageType, PptOutline } from "./types";

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

export function pageCode(index: number): string {
  return `page-${String(index + 1).padStart(2, "0")}`;
}

export function asOutlinePage(title: string, bullets: string[]): OutlinePage {
  return { title, content: bullets };
}
