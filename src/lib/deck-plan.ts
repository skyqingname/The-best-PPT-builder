import crypto from "node:crypto";
import { generateJson } from "./model-gateway";
import { DECK_PLAN_SYSTEM } from "./prompts";
import { getDeckPlan, saveDeckPlan } from "./project-artifacts";
import { requireTextConfig } from "./settings";
import { getProject, listPages, updateProject } from "./store";
import type {
  DeckPagePlan,
  DeckPlan,
  DeckVisualSystem,
  PageRow,
  PageType,
  VisualSlotKind,
} from "./types";

interface DeckPlanRuntime {
  signal: AbortSignal;
  assertActive: () => void;
  log: (title: string, detail?: string, kind?: string) => void;
  onRetry: (input: { attempt: number; maxAttempts: number; delayMs: number }) => void;
}

interface RawDeckPage {
  page_code?: string;
  page_type?: string;
  title?: string;
  objective?: string;
  layout?: string;
  hierarchy?: string[];
  reading_order?: string[];
  visual_slots?: Array<{
    kind?: string;
    purpose?: string;
    placement?: string;
    aspect_ratio?: string;
    query?: string;
    fallback?: string;
  }>;
}

interface RawDeckPlan {
  shared?: Partial<DeckVisualSystem> & {
    title_system?: string;
    card_system?: string;
    graphic_language?: string;
    consistency_rules?: string[];
  };
  pages?: RawDeckPage[];
}

export function deckOutlineFingerprint(pages: PageRow[]): string {
  const payload = pages.map((page) => ({
    code: page.page_code,
    type: page.page_type,
    section: page.section_title,
    title: page.title,
    bullets: page.bullets_json,
    summary: page.summary_md.slice(0, 1800),
  }));
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 24);
}

export async function ensureDeckPlan(
  projectId: string,
  runtime: DeckPlanRuntime,
): Promise<DeckPlan> {
  const pages = listPages(projectId);
  const fingerprint = deckOutlineFingerprint(pages);
  const current = getDeckPlan(projectId);
  if (current?.status === "ready" && current.outlineFingerprint === fingerprint) {
    return current;
  }

  const project = getProject(projectId);
  updateProject(projectId, { stage: "planning", status: "running" });
  runtime.log("正在统一整套内容策划", `${pages.length} 页共用一份 Deck Plan`, "info");
  const payload = await generateJson<RawDeckPlan>(requireTextConfig(), [
    { role: "system", content: DECK_PLAN_SYSTEM },
    {
      role: "user",
      content: JSON.stringify({
        topic: project.request_text,
        existing_shared_system: current?.shared ?? null,
        instruction: current?.shared
          ? "严格保留 existing_shared_system，只更新逐页计划以适配当前结构"
          : "建立一套清爽、统一、适合评审的策划稿视觉合同",
        pages: pages.map((page) => ({
          page_code: page.page_code,
          page_type: page.page_type,
          section_title: page.section_title,
          title: page.title,
          outline_points: JSON.parse(page.bullets_json || "[]"),
          evidence_brief: page.summary_md.slice(0, 4200),
        })),
      }),
    },
  ], {
    signal: runtime.signal,
    onRetry: runtime.onRetry,
  });
  runtime.assertActive();
  const plan = normalizeDeckPlan(payload, pages, current?.shared, fingerprint);
  saveDeckPlan(projectId, plan);
  runtime.log("整套内容策划已就绪", "版式、字阶与配图意图已统一", "success");
  return plan;
}

export function pagePlanFor(plan: DeckPlan | null, page: PageRow): DeckPagePlan {
  return plan?.pages.find((item) => item.pageCode === page.page_code)
    ?? fallbackPagePlan(page);
}

function normalizeDeckPlan(
  raw: RawDeckPlan,
  pages: PageRow[],
  preservedShared: DeckVisualSystem | undefined,
  fingerprint: string,
): DeckPlan {
  const shared = preservedShared ?? normalizeShared(raw.shared);
  const byCode = new Map((raw.pages ?? []).map((page) => [page.page_code, page]));
  return {
    version: 1,
    status: "ready",
    generatedAt: new Date().toISOString(),
    outlineFingerprint: fingerprint,
    shared,
    pages: pages.map((page) => normalizePagePlan(page, byCode.get(page.page_code))),
  };
}

function normalizeShared(raw: RawDeckPlan["shared"]): DeckVisualSystem {
  return {
    concept: clean(raw?.concept) || "编辑式信息工坊：清爽、克制、结论先行",
    canvas: clean(raw?.canvas) || "1280×720 浅暖灰画布，统一使用纯色背景",
    grid: clean(raw?.grid) || "12 栏网格，内容区按 20px 间距组合",
    margins: clean(raw?.margins) || "四周 52px 安全边距，标题区与内容区间隔 24px",
    titleSystem: clean(raw?.titleSystem ?? raw?.title_system)
      || "标题固定在左上，主标题 30–36px，章节眉题 14px",
    typography: clean(raw?.typography)
      || "中文无衬线；标题 30–36px，卡片标题 20–24px，正文 16–20px，辅助文字 13–15px",
    palette: normalizePalette(raw?.palette),
    cardSystem: clean(raw?.cardSystem ?? raw?.card_system)
      || "12–16px 圆角、1px 冷灰描边、无重阴影；卡片间距至少 20px",
    graphicLanguage: clean(raw?.graphicLanguage ?? raw?.graphic_language)
      || "线性图标、扁平信息图、清晰节点连线；不用装饰性 HUD",
    consistencyRules: cleanList(raw?.consistencyRules ?? raw?.consistency_rules).length
      ? cleanList(raw?.consistencyRules ?? raw?.consistency_rules)
      : ["标题锚点跨页一致", "卡片半径与间距一致", "强调色每页只承担一种语义"],
  };
}

function normalizePagePlan(page: PageRow, raw?: RawDeckPage): DeckPagePlan {
  if (!raw) return fallbackPagePlan(page);
  const slots = (raw.visual_slots ?? []).slice(0, 3).map((slot) => ({
    kind: normalizeVisualKind(slot.kind),
    purpose: clean(slot.purpose),
    placement: clean(slot.placement),
    aspectRatio: clean(slot.aspect_ratio) || "16:10",
    query: clean(slot.query),
    fallback: clean(slot.fallback) || "用原生 SVG 信息图完成同一信息任务",
  })).filter((slot) => slot.kind !== "none" || slot.purpose);
  const fallback = fallbackPagePlan(page);
  return {
    pageCode: page.page_code,
    pageType: page.page_type,
    title: page.title,
    objective: clean(raw.objective) || fallback.objective,
    layout: clean(raw.layout) || fallback.layout,
    hierarchy: cleanList(raw.hierarchy).length ? cleanList(raw.hierarchy) : fallback.hierarchy,
    readingOrder: cleanList(raw.reading_order).length ? cleanList(raw.reading_order) : fallback.readingOrder,
    visualSlots: slots.length ? slots : fallback.visualSlots,
  };
}

function fallbackPagePlan(page: PageRow): DeckPagePlan {
  const bullets = JSON.parse(page.bullets_json || "[]") as string[];
  const kind = inferVisualKind(page.page_type, `${page.title} ${bullets.join(" ")}`);
  const layouts: Record<PageType, string> = {
    cover: "单一焦点：左侧标题与右侧概念主视觉",
    toc: "编号故事线：章节标题形成清晰阅读路径",
    section: "大留白章节换场：超大标题与单一概念图形",
    content: kind === "photo"
      ? "非对称两栏：信息卡 2/3，实拍图位 1/3"
      : "主次结合：主结论卡与辅助信息图",
    end: "单一焦点：核心结论居中收束",
  };
  return {
    pageCode: page.page_code,
    pageType: page.page_type,
    title: page.title,
    objective: bullets[0] || page.title,
    layout: layouts[page.page_type],
    hierarchy: [page.title, ...bullets.slice(0, 3)],
    readingOrder: ["页面结论", "核心证据", "视觉解释"],
    visualSlots: page.page_type === "content"
      ? [{
          kind,
          purpose: kind === "photo" ? "建立真实场景与对象认知" : "把核心关系从文字转成可扫读视觉",
          placement: "主内容区的视觉焦点卡",
          aspectRatio: "16:10",
          query: kind === "photo" ? `${page.title} 真实场景 专业摄影` : "",
          fallback: "使用原生 SVG 关系图或主题插画完成表达",
        }]
      : [{
          kind: "svg_illustration",
          purpose: "建立页型识别与叙事节奏",
          placement: "标题相对侧",
          aspectRatio: "1:1",
          query: "",
          fallback: "使用原生 SVG 概念图形",
        }],
  };
}

function inferVisualKind(pageType: PageType, text: string): VisualSlotKind {
  if (pageType !== "content") return "svg_illustration";
  if (/趋势|增长|比例|数据|预算|成本|对比|排名/.test(text)) return "chart";
  if (/流程|路径|步骤|体系|关系|架构|闭环|机制/.test(text)) return "diagram";
  if (/地点|建筑|产品|人物|空间|旅游|酒店|工厂|门店|案例/.test(text)) return "photo";
  return "svg_illustration";
}

function normalizeVisualKind(value: string | undefined): VisualSlotKind {
  return ["diagram", "chart", "svg_illustration", "photo", "none"].includes(value || "")
    ? value as VisualSlotKind
    : "svg_illustration";
}

function normalizePalette(value: unknown): string[] {
  const colors = Array.isArray(value)
    ? value.map((item) => clean(item)).filter((item) => /^#[0-9a-f]{6}$/i.test(item)).slice(0, 6)
    : [];
  return colors.length >= 3 ? colors : ["#F7F8FA", "#17243A", "#2F80FF", "#DCE5F2"];
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, 600) : "";
}

function cleanList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(clean).filter(Boolean).slice(0, 12) : [];
}
