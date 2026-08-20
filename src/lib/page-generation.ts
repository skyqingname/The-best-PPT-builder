import type { LlmProgressUpdate } from "./llm";
import { pagePlanFor } from "./deck-plan";
import { generateSvg } from "./model-gateway";
import {
  designSvgSystem,
  designUserPrompt,
  draftUserPrompt,
  draftSvgSystem,
} from "./prompts";
import { compactHits, webSearch } from "./search";
import { getDeckPlan, getReferenceState } from "./project-artifacts";
import { requireSearch, requireSvgConfig } from "./settings";
import { getPage, getProject, listPages, updatePage, updateProject } from "./store";
import { getStylePack } from "./styles";
import type { PageRow, SearchHit } from "./types";

export interface PageGenerationRuntime {
  signal: AbortSignal;
  assertActive: () => void;
  isCancelled: () => boolean;
  log: (title: string, detail?: string, kind?: string, pageId?: string) => void;
  searchProgress: (query: string, pageId: string) => (update: LlmProgressUpdate) => void;
  modelRetry: (
    label: string,
    pageId: string,
  ) => (input: { attempt: number; maxAttempts: number; delayMs: number }) => void;
}

export function prepareFixedPageEvidence(
  projectId: string,
  page: PageRow,
  runtime: PageGenerationRuntime,
) {
  const project = getProject(projectId);
  const sources = compactHits(
    JSON.parse(project.init_sources_json || "[]") as SearchHit[],
    3,
  );
  const bullets = JSON.parse(page.bullets_json || "[]") as string[];
  updatePage(page.id, {
    search_queries_json: "[]",
    sources_json: JSON.stringify(sources),
    summary_md: [
      `# ${page.title}`,
      page.section_title ? `所属章节：${page.section_title}` : "",
      ...bullets.map((bullet) => `- ${bullet}`),
      sources.length ? `项目级资料：${sources.map((source) => source.title).join("；")}` : "",
    ].filter(Boolean).join("\n"),
    search_status: "ready",
    summary_status: "ready",
  });
  runtime.log("固定页资料已准备", page.title, "success", page.id);
}

export async function researchPage(
  projectId: string,
  pageId: string,
  runtime: PageGenerationRuntime,
) {
  const project = getProject(projectId);
  const page = getPage(pageId);
  const search = requireSearch();
  updateProjectStage(projectId, "research");
  updatePage(pageId, { search_status: "running", summary_status: "running" });
  runtime.log(`检索 ${page.title}`, "", "info", pageId);

  const snapshot = listPages(projectId).map((item) => ({
    title: item.title,
    section: item.section_title,
  }));
  const bullets = JSON.parse(page.bullets_json || "[]") as string[];
  const task = JSON.stringify({
    project: project.request_text,
    page: { title: page.title, section: page.section_title, bullets },
    cross_page_outline: snapshot,
    objective: "一次检索覆盖当前页全部要点，返回可直接支撑页面论证的公开来源",
    instruction: "优先一手来源和权威数据，避免与其它页面重复",
  });
  const found = await webSearch(search, task, {
    onProgress: runtime.searchProgress(page.title, pageId),
    shouldCancel: runtime.isCancelled,
    signal: runtime.signal,
  });
  const unique = dedupeHits(found).slice(0, 5);
  runtime.assertActive();
  updatePage(pageId, {
    search_queries_json: JSON.stringify([{ query: page.title, purpose: "当前页事实与证据" }]),
    sources_json: JSON.stringify(unique),
    summary_md: buildEvidenceBrief(page, bullets, unique),
    search_status: "ready",
    summary_status: "ready",
  });
  runtime.log("页面资料已就绪", `${unique.length} 条来源`, "success", pageId);
}

export async function draftPage(
  projectId: string,
  pageId: string,
  instruction: string | undefined,
  runtime: PageGenerationRuntime,
) {
  const page = getPage(pageId);
  const plan = getDeckPlan(projectId);
  const pagePlan = pagePlanFor(plan, page);
  const svg = requireSvgConfig();
  updateProjectStage(projectId, "draft");
  updatePage(pageId, { draft_status: "running" });
  runtime.log(`策划稿 ${page.title}`, "", "info", pageId);
  const draftSvg = await generateSvg(
    svg,
    [
      { role: "system", content: draftSvgSystem(page.page_type) },
      {
        role: "user",
        content: draftUserPrompt({
          pageType: page.page_type,
          title: page.title,
          sectionTitle: page.section_title,
          bullets: JSON.parse(page.bullets_json || "[]"),
          summary: page.summary_md,
          deckSystem: plan?.shared,
          pagePlan,
          instruction,
        }),
      },
    ],
    {
      maxTokens: 12000,
      temperature: 0.5,
      signal: runtime.signal,
      onRetry: runtime.modelRetry("生成 PPT 初稿", pageId),
    },
  );
  runtime.assertActive();
  updatePage(pageId, {
    draft_svg: draftSvg,
    draft_status: "ready",
    design_status: page.design_svg ? "stale" : "empty",
  });
  runtime.log("PPT初稿已就绪", page.title, "success", pageId);
}

export async function designPage(
  projectId: string,
  pageId: string,
  instruction: string | undefined,
  runtime: PageGenerationRuntime,
) {
  const project = getProject(projectId);
  const page = getPage(pageId);
  if (!page.draft_svg) throw new Error("没有策划稿，不能出设计稿");
  const svg = requireSvgConfig();
  const style = getStylePack(project.style_id);
  const plan = getDeckPlan(projectId);
  const reference = getReferenceState(projectId, project.style_id);
  const legacyDesign = listPages(projectId).some((item) => item.design_status === "ready");
  if (reference.status !== "confirmed" && !legacyDesign) {
    throw new Error("请先确认设计参考，再生成设计稿");
  }
  const pagePlan = pagePlanFor(plan, page);
  updateProjectStage(projectId, "design");
  updatePage(pageId, { design_status: "running" });
  runtime.log(`设计稿 ${page.title}`, style.name, "info", pageId);
  const designSvg = await generateSvg(
    svg,
    [
      {
        role: "system",
        content: designSvgSystem(style, page.page_type, reference.profile),
      },
      {
        role: "user",
        content: designUserPrompt({
          draftSvg: page.draft_svg,
          pageType: page.page_type,
          title: page.title,
          sectionTitle: page.section_title,
          deckSystem: plan?.shared,
          pagePlan,
          reference: reference.profile,
          colorPreference: reference.colorPreference,
          instruction,
        }),
      },
    ],
    {
      maxTokens: 12000,
      temperature: 0.4,
      signal: runtime.signal,
      onRetry: runtime.modelRetry("生成视觉设计", pageId),
    },
  );
  runtime.assertActive();
  updatePage(pageId, { design_svg: designSvg, design_status: "ready" });
  runtime.log("设计稿已就绪", page.title, "success", pageId);
}

function updateProjectStage(projectId: string, stage: "research" | "draft" | "design") {
  const project = getProject(projectId);
  if (project.stage !== stage || project.status !== "running") {
    updateProject(projectId, { stage, status: "running" });
  }
}

function dedupeHits(hits: SearchHit[]): SearchHit[] {
  const seen = new Set<string>();
  return hits.filter((hit) => {
    const key = hit.url || hit.title;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildEvidenceBrief(page: PageRow, bullets: string[], hits: SearchHit[]): string {
  const evidence = hits.map((hit, index) => {
    const excerpt = (hit.content || hit.snippet).replace(/\s+/g, " ").trim().slice(0, 900);
    return [`## 来源 ${index + 1}｜${hit.title}`, `URL：${hit.url}`, excerpt].join("\n");
  });
  return [
    `# 页面证据简报｜${page.title}`,
    `页面目标：${bullets.join("；") || page.title}`,
    ...evidence,
    hits.length ? "" : "未检索到可靠公开来源。仅使用页面提纲，不补造事实。",
  ].filter(Boolean).join("\n\n");
}
