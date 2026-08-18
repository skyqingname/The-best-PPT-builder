import { emitProjectChange } from "./events-bus";
import { completeChat, extractJsonObject, extractSvg } from "./llm";
import { flattenOutline, pageCode, parseOutline } from "./outline";
import {
  ASSUMPTIONS_SYSTEM,
  designSvgSystem,
  designUserPrompt,
  DRAFT_SVG_SYSTEM,
  draftUserPrompt,
  INIT_QUERIES_SYSTEM,
  OUTLINE_SYSTEM,
  PAGE_QUERY_SYSTEM,
  PAGE_SUMMARY_SYSTEM,
} from "./prompts";
import { compactHits, webSearch } from "./search";
import { requireSearch, requireSvgConfig, requireTextConfig } from "./settings";
import {
  addEvent,
  deletePagesNotIn,
  getPage,
  getProject,
  insertPage,
  listPages,
  parseAssumptions,
  updatePage,
  updateProject,
} from "./store";
import { getStylePack, pickStyleForTopic } from "./styles";
import type {
  PageRow,
  PptOutline,
  ProjectAssumptions,
  SearchHit,
} from "./types";

const running = new Set<string>();
const cancelFlags = new Set<string>();

function touch(projectId: string) {
  emitProjectChange(projectId);
}

function log(
  projectId: string,
  title: string,
  detail = "",
  kind = "info",
  pageId?: string,
) {
  addEvent({ projectId, pageId, kind, title, detail });
  touch(projectId);
}

function assertNotCancelled(projectId: string) {
  if (cancelFlags.has(projectId)) {
    throw new Error("CANCELLED");
  }
}

export function requestCancel(projectId: string) {
  cancelFlags.add(projectId);
}

export function isRunning(projectId: string): boolean {
  return running.has(projectId);
}

export function enqueuePipeline(projectId: string) {
  if (running.has(projectId)) return;
  running.add(projectId);
  cancelFlags.delete(projectId);
  void runPipeline(projectId)
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      if (message === "CANCELLED") {
        updateProject(projectId, { status: "paused" });
        log(projectId, "已暂停", "等待你的修改后再继续", "status");
        return;
      }
      updateProject(projectId, { status: "failed", stage: "failed", error_text: message });
      log(projectId, "流程失败", message, "error");
    })
    .finally(() => {
      running.delete(projectId);
      touch(projectId);
    });
}

async function runPipeline(projectId: string) {
  updateProject(projectId, { status: "running", error_text: null });
  const project = getProject(projectId);
  if (!project.outline_json) {
    await runInitAndOutline(projectId);
  }
  await runPendingPages(projectId);
  const pages = listPages(projectId);
  const allDesigned = pages.every((page) => page.design_status === "ready");
  if (allDesigned && pages.length > 0) {
    updateProject(projectId, { stage: "done", status: "completed" });
    log(projectId, "PPT设计稿已就绪", `共 ${pages.length} 页`, "success");
  } else {
    updateProject(projectId, { status: "paused" });
  }
}

async function runInitAndOutline(projectId: string) {
  const project = getProject(projectId);
  const text = requireTextConfig();
  const search = requireSearch();

  updateProject(projectId, { stage: "init" });
  log(projectId, "开始需求调研", project.request_text);

  const queryRaw = await completeChat(text, [
    { role: "system", content: INIT_QUERIES_SYSTEM },
    { role: "user", content: project.request_text },
  ]);
  assertNotCancelled(projectId);
  const queryPayload = extractJsonObject(queryRaw) as {
    queries?: Array<{ query?: string; purpose?: string }>;
  };
  const queries = (queryPayload.queries ?? [])
    .map((item) => item.query?.trim())
    .filter((item): item is string => Boolean(item))
    .slice(0, 6);
  if (queries.length === 0) queries.push(project.request_text);

  const initHits: SearchHit[] = [];
  for (const query of queries) {
    assertNotCancelled(projectId);
    log(projectId, `检索：${query}`);
    const hits = await webSearch(search.provider, search.apiKey, query);
    initHits.push(...compactHits(hits, 4));
  }
  updateProject(projectId, { init_sources_json: JSON.stringify(compactHits(initHits, 12)) });

  const style = pickStyleForTopic(project.request_text);
  const assumptionRaw = await completeChat(text, [
    { role: "system", content: ASSUMPTIONS_SYSTEM },
    {
      role: "user",
      content: JSON.stringify({
        topic: project.request_text,
        sources: compactHits(initHits, 8).map((hit) => ({
          title: hit.title,
          url: hit.url,
          snippet: hit.snippet || hit.content.slice(0, 280),
        })),
      }),
    },
  ]);
  assertNotCancelled(projectId);
  const assumptionPayload = extractJsonObject(assumptionRaw) as {
    page_count?: number;
    audience?: string;
    purpose?: string;
    questions?: Array<{ id?: string; label?: string; value?: string; reason?: string }>;
  };
  const assumptions: ProjectAssumptions = {
    pageCount: Math.min(16, Math.max(8, Number(assumptionPayload.page_count) || 12)),
    audience: assumptionPayload.audience || "通用商务听众",
    purpose: assumptionPayload.purpose || "讲清楚主题并促成决策",
    styleId: style.id,
    questions: (assumptionPayload.questions ?? []).slice(0, 5).map((item, index) => ({
      id: item.id || `q${index + 1}`,
      label: item.label || `问题${index + 1}`,
      value: item.value || "",
      reason: item.reason || "",
    })),
  };
  updateProject(projectId, {
    assumptions_json: JSON.stringify(assumptions),
    page_count_target: assumptions.pageCount,
    style_id: style.id,
  });
  log(
    projectId,
    "已生成可改假设",
    `页数 ${assumptions.pageCount} · 风格 ${style.name} · ${assumptions.audience}`,
    "success",
  );

  await generateOutline(projectId);
}

export async function generateOutline(projectId: string) {
  const project = getProject(projectId);
  const text = requireTextConfig();
  const assumptions = parseAssumptions(project);
  const sources = JSON.parse(project.init_sources_json || "[]") as SearchHit[];

  updateProject(projectId, { stage: "outline", status: "running" });
  log(projectId, "正在生成大纲便利贴");

  const system = OUTLINE_SYSTEM.replace(
    "{{PAGE_REQUIREMENTS}}",
    `整份 PPT 总页数约 ${assumptions.pageCount} 页，必须包含封面、目录、内容页和结尾。`,
  );
  const raw = await completeChat(text, [
    { role: "system", content: system },
    {
      role: "user",
      content: JSON.stringify({
        topic: project.request_text,
        audience: assumptions.audience,
        purpose: assumptions.purpose,
        answers: assumptions.questions,
        research: compactHits(sources, 10).map((hit) => ({
          title: hit.title,
          url: hit.url,
          snippet: hit.snippet || hit.content.slice(0, 300),
        })),
      }),
    },
  ]);
  assertNotCancelled(projectId);
  const outline = parseOutline(raw);
  reconcilePages(projectId, outline);
  updateProject(projectId, {
    title: outline.cover.title.slice(0, 40),
    outline_json: JSON.stringify(outline),
    stage: "research",
  });
  log(projectId, "便利贴已就绪", "后台继续按页检索和出稿", "success");
}

function reconcilePages(projectId: string, outline: PptOutline) {
  const flat = flattenOutline(outline);
  const existing = listPages(projectId);
  const keep: string[] = [];
  flat.forEach((item, index) => {
    const current = existing[index];
    const bullets = item.bullets;
    if (current) {
      const titleChanged = current.title !== item.title;
      const bulletChanged = current.bullets_json !== JSON.stringify(bullets);
      const typeChanged = current.page_type !== item.pageType;
      updatePage(current.id, {
        page_code: pageCode(index),
        sort_order: index,
        page_type: item.pageType,
        section_title: item.sectionTitle,
        title: item.title,
        bullets_json: JSON.stringify(bullets),
        needs_rerun: titleChanged || bulletChanged || typeChanged ? 1 : current.needs_rerun,
        search_status:
          titleChanged || bulletChanged ? "stale" : current.search_status,
        summary_status:
          titleChanged || bulletChanged ? "stale" : current.summary_status,
        draft_status: titleChanged || bulletChanged ? "stale" : current.draft_status,
        design_status: titleChanged || bulletChanged ? "stale" : current.design_status,
      });
      keep.push(current.id);
    } else {
      const created = insertPage({
        projectId,
        pageCode: pageCode(index),
        sortOrder: index,
        pageType: item.pageType,
        sectionTitle: item.sectionTitle,
        title: item.title,
        bullets,
      });
      keep.push(created.id);
    }
  });
  deletePagesNotIn(projectId, keep);
}

async function runPendingPages(projectId: string) {
  const pages = listPages(projectId);
  for (const page of pages) {
    assertNotCancelled(projectId);
    const needsWork =
      page.needs_rerun === 1 ||
      page.search_status !== "ready" ||
      page.summary_status !== "ready" ||
      page.draft_status !== "ready" ||
      page.design_status !== "ready";
    if (!needsWork) continue;
    await runOnePage(projectId, page.id);
  }
}

export async function runOnePage(projectId: string, pageId: string) {
  let page = getPage(pageId);
  if (page.search_status !== "ready" || page.summary_status !== "ready" || page.needs_rerun === 1) {
    await researchPage(projectId, pageId);
    page = getPage(pageId);
  }
  if (page.draft_status !== "ready" || page.needs_rerun === 1) {
    await draftPage(projectId, pageId);
    page = getPage(pageId);
  }
  if (page.design_status !== "ready" || page.needs_rerun === 1) {
    await designPage(projectId, pageId);
  }
  updatePage(pageId, { needs_rerun: 0 });
}

async function researchPage(projectId: string, pageId: string) {
  const project = getProject(projectId);
  const page = getPage(pageId);
  const text = requireTextConfig();
  const search = requireSearch();
  updateProject(projectId, { stage: "research", status: "running" });
  updatePage(pageId, { search_status: "running", summary_status: "running" });
  log(projectId, `检索 ${page.title}`, "", "info", pageId);

  const snapshot = listPages(projectId).map((item) => ({
    title: item.title,
    section: item.section_title,
    bullets: JSON.parse(item.bullets_json || "[]"),
  }));
  const queryRaw = await completeChat(text, [
    { role: "system", content: PAGE_QUERY_SYSTEM },
    {
      role: "user",
      content: JSON.stringify({
        project: project.request_text,
        page: {
          title: page.title,
          section: page.section_title,
          bullets: JSON.parse(page.bullets_json || "[]"),
        },
        outline_snapshot: snapshot,
      }),
    },
  ]);
  assertNotCancelled(projectId);
  const queryPayload = extractJsonObject(queryRaw) as {
    queries?: Array<{ query?: string; purpose?: string }>;
  };
  const queries = (queryPayload.queries ?? [])
    .map((item) => item.query?.trim())
    .filter((item): item is string => Boolean(item))
    .slice(0, 5);
  if (queries.length === 0) queries.push(page.title);

  const hits: SearchHit[] = [];
  for (const query of queries) {
    assertNotCancelled(projectId);
    const found = await webSearch(search.provider, search.apiKey, query);
    hits.push(...compactHits(found, 3));
    log(projectId, `R  ${query}`, `${found.length} 条`, "search", pageId);
  }
  const unique = dedupeHits(hits).slice(0, 8);

  const summaryRaw = await completeChat(text, [
    { role: "system", content: PAGE_SUMMARY_SYSTEM },
    {
      role: "user",
      content: JSON.stringify({
        page_title: page.title,
        bullets: JSON.parse(page.bullets_json || "[]"),
        selected_sources: unique.map((hit) => ({
          title: hit.title,
          url: hit.url,
          content: hit.content.slice(0, 1400),
        })),
      }),
    },
  ]);
  assertNotCancelled(projectId);
  const summaryPayload = extractJsonObject(summaryRaw) as { summary_md?: string };
  updatePage(pageId, {
    search_queries_json: JSON.stringify(queryPayload.queries ?? queries.map((query) => ({ query }))),
    sources_json: JSON.stringify(unique),
    summary_md: summaryPayload.summary_md || summaryRaw,
    search_status: "ready",
    summary_status: "ready",
  });
}

async function draftPage(projectId: string, pageId: string, instruction?: string) {
  const page = getPage(pageId);
  const svg = requireSvgConfig();
  updateProject(projectId, { stage: "draft", status: "running" });
  updatePage(pageId, { draft_status: "running" });
  log(projectId, `策划稿 ${page.title}`, "", "info", pageId);
  const raw = await completeChat(
    svg,
    [
      { role: "system", content: pageSystemForType(page) },
      {
        role: "user",
        content: draftUserPrompt({
          pageType: page.page_type,
          title: page.title,
          sectionTitle: page.section_title,
          bullets: JSON.parse(page.bullets_json || "[]"),
          summary: page.summary_md,
          instruction,
        }),
      },
    ],
    { maxTokens: 12000, temperature: 0.5 },
  );
  assertNotCancelled(projectId);
  updatePage(pageId, {
    draft_svg: extractSvg(raw),
    draft_status: "ready",
    design_status: page.design_svg ? "stale" : "empty",
  });
  log(projectId, "PPT初稿已就绪", page.title, "success", pageId);
}

async function designPage(projectId: string, pageId: string, instruction?: string) {
  const project = getProject(projectId);
  const page = getPage(pageId);
  if (!page.draft_svg) {
    throw new Error("没有策划稿，不能出设计稿");
  }
  const svg = requireSvgConfig();
  const style = getStylePack(project.style_id);
  updateProject(projectId, { stage: "design", status: "running" });
  updatePage(pageId, { design_status: "running" });
  log(projectId, `设计稿 ${page.title}`, style.name, "info", pageId);
  const raw = await completeChat(
    svg,
    [
      { role: "system", content: designSvgSystem(style) },
      { role: "user", content: designUserPrompt(page.draft_svg, instruction) },
    ],
    { maxTokens: 12000, temperature: 0.4 },
  );
  assertNotCancelled(projectId);
  updatePage(pageId, {
    design_svg: extractSvg(raw),
    design_status: "ready",
  });
  log(projectId, "设计稿已就绪", page.title, "success", pageId);
}

function pageSystemForType(page: PageRow): string {
  if (page.page_type === "content") return DRAFT_SVG_SYSTEM;
  return `${DRAFT_SVG_SYSTEM}

额外约束：当前页类型是 ${page.page_type}，不要使用内容页 Bento 卡片墙。`;
}

function dedupeHits(hits: SearchHit[]): SearchHit[] {
  const seen = new Set<string>();
  const result: SearchHit[] = [];
  for (const hit of hits) {
    const key = hit.url || hit.title;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(hit);
  }
  return result;
}

export async function rerunDesigns(projectId: string) {
  const pages = listPages(projectId);
  for (const page of pages) {
    if (page.draft_svg) {
      updatePage(page.id, { design_status: "stale", needs_rerun: 1 });
    }
  }
  enqueuePipeline(projectId);
}

export async function applyAssumptionPatch(
  projectId: string,
  patch: Partial<ProjectAssumptions> & { rebuildOutline?: boolean },
) {
  const project = getProject(projectId);
  const current = parseAssumptions(project);
  const next: ProjectAssumptions = {
    ...current,
    ...patch,
    questions: patch.questions ?? current.questions,
  };
  const styleOnly =
    patch.styleId &&
    patch.styleId !== current.styleId &&
    !patch.rebuildOutline &&
    patch.pageCount === undefined &&
    !patch.audience &&
    !patch.purpose &&
    !patch.questions;

  updateProject(projectId, {
    assumptions_json: JSON.stringify(next),
    page_count_target: next.pageCount,
    style_id: next.styleId,
    status: "running",
  });

  if (styleOnly) {
    log(projectId, "风格已更新", getStylePack(next.styleId).name, "success");
    await rerunDesigns(projectId);
    return;
  }

  requestCancel(projectId);
  log(projectId, "假设已更新，重算大纲及下游");
  setTimeout(() => {
    cancelFlags.delete(projectId);
    void generateOutline(projectId)
      .then(() => enqueuePipeline(projectId))
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        updateProject(projectId, { status: "failed", error_text: message });
        log(projectId, "重算失败", message, "error");
      });
  }, 300);
}

export async function applyPageEdit(
  projectId: string,
  pageId: string,
  input: {
    title?: string;
    bullets?: string[];
    speakerNotes?: string;
    instruction?: string;
    regenerate?: "research" | "draft" | "design" | "all";
  },
) {
  const page = getPage(pageId);
  updatePage(pageId, {
    title: input.title ?? page.title,
    bullets_json: input.bullets ? JSON.stringify(input.bullets) : page.bullets_json,
    speaker_notes: input.speakerNotes ?? page.speaker_notes,
  });

  if (!input.regenerate && !input.instruction && !input.title && !input.bullets) {
    return;
  }

  const regen = input.regenerate ?? "all";
  if (regen === "research" || regen === "all") {
    updatePage(pageId, {
      search_status: "stale",
      summary_status: "stale",
      draft_status: "stale",
      design_status: "stale",
      needs_rerun: 1,
    });
    enqueuePipeline(projectId);
    return;
  }
  if (regen === "draft") {
    await draftPage(projectId, pageId, input.instruction);
    await designPage(projectId, pageId);
    return;
  }
  if (regen === "design") {
    await designPage(projectId, pageId, input.instruction);
  }
}

