import { emitProjectChange } from "./events-bus";
import { completeChat, extractJsonObject, extractSvg } from "./llm";
import type { LlmProgressUpdate } from "./llm";
import { invalidateFrom } from "./invalidation";
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
  reorderPages,
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
const rerunRequests = new Set<string>();
const outlineRebuildRequests = new Set<string>();
const pageInstructions = new Map<string, { draft?: string; design?: string }>();

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

function reportSearchProgress(
  projectId: string,
  query: string,
  pageId?: string,
): (update: LlmProgressUpdate) => void {
  const titles: Omit<Record<LlmProgressUpdate["phase"], string>, "retrying"> = {
    request_sent: "搜索请求已提交",
    response_started: "搜索模型已响应",
    tool_running: "正在搜索网页",
    output_streaming: "正在整理来源",
    completed: "搜索结果已返回",
  };
  return (update) => {
    if (update.phase === "retrying") {
      const seconds = Math.ceil((update.delayMs ?? 0) / 1000);
      log(
        projectId,
        `模型繁忙，${seconds} 秒后重试`,
        `第 ${update.attempt ?? 2} / ${update.maxAttempts ?? 5} 次 · ${query}`,
        "search-progress",
        pageId,
      );
      return;
    }
    log(projectId, titles[update.phase], query, "search-progress", pageId);
  };
}

export function requestCancel(projectId: string) {
  cancelFlags.add(projectId);
  updateProject(projectId, { status: "paused" });
}

export function isRunning(projectId: string): boolean {
  return running.has(projectId);
}

export function enqueuePipeline(
  projectId: string,
  options: { rebuildOutline?: boolean; cancelRunning?: boolean } = {},
) {
  rerunRequests.add(projectId);
  if (options.rebuildOutline) outlineRebuildRequests.add(projectId);
  if (options.cancelRunning && running.has(projectId)) requestCancel(projectId);
  if (running.has(projectId)) return;
  running.add(projectId);
  void runProjectWorker(projectId)
    .finally(() => {
      running.delete(projectId);
      touch(projectId);
    });
}

async function runProjectWorker(projectId: string) {
  while (rerunRequests.delete(projectId)) {
    cancelFlags.delete(projectId);
    try {
      if (outlineRebuildRequests.delete(projectId)) {
        await generateOutline(projectId);
      }
      await runPipeline(projectId);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === "CANCELLED") {
        if (rerunRequests.has(projectId)) continue;
        updateProject(projectId, { status: "paused" });
        log(projectId, "已暂停", "可以修改后继续生成", "status");
        return;
      }
      rerunRequests.delete(projectId);
      outlineRebuildRequests.delete(projectId);
      updateProject(projectId, { status: "failed", stage: "failed", error_text: message });
      log(projectId, "流程失败", message, "error");
      return;
    }
  }
}

async function runPipeline(projectId: string) {
  updateProject(projectId, { status: "running", error_text: null });
  const project = getProject(projectId);
  if (!project.outline_json) {
    const assumptions = parseAssumptions(project);
    if (assumptions.questions.length === 0) {
      await runInitialResearch(projectId);
    } else {
      updateProject(projectId, { stage: "requirements", status: "paused" });
    }
    return;
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

async function runInitialResearch(projectId: string) {
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
    const hits = await webSearch(search, query, {
      onProgress: reportSearchProgress(projectId, query),
      shouldCancel: () => cancelFlags.has(projectId),
    });
    assertNotCancelled(projectId);
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
    questions?: Array<{
      id?: string;
      label?: string;
      value?: string;
      reason?: string;
      options?: string[];
    }>;
  };
  const generatedQuestions = (assumptionPayload.questions ?? [])
    .slice(0, 5)
    .map((item, index) => normalizeQuestion(item, index))
    .filter((item) => item.options.length > 0);
  const assumptions: ProjectAssumptions = {
    pageCount: Math.min(16, Math.max(8, Number(assumptionPayload.page_count) || 12)),
    audience: assumptionPayload.audience || "通用商务听众",
    purpose: assumptionPayload.purpose || "讲清楚主题并促成决策",
    styleId: style.id,
    questions: generatedQuestions.length >= 3
      ? generatedQuestions
      : fallbackQuestions(
          assumptionPayload.audience || "通用商务听众",
          assumptionPayload.purpose || "讲清楚主题并促成决策",
          Math.min(16, Math.max(8, Number(assumptionPayload.page_count) || 12)),
        ),
  };
  updateProject(projectId, {
    assumptions_json: JSON.stringify(assumptions),
    page_count_target: assumptions.pageCount,
    style_id: style.id,
    stage: "requirements",
    status: "paused",
  });
  log(
    projectId,
    "背景调研已完成",
    `已整理 ${assumptions.questions.length} 个关键问题，确认后生成结构板`,
    "success",
  );
}

function normalizeQuestion(
  item: { id?: string; label?: string; value?: string; reason?: string; options?: string[] },
  index: number,
): ProjectAssumptions["questions"][number] {
  const options = Array.from(
    new Set((item.options ?? []).map((option) => option.trim()).filter(Boolean)),
  ).slice(0, 3);
  const recommended = item.value?.trim() || options[0] || "";
  if (recommended && !options.includes(recommended)) options.unshift(recommended);
  return {
    id: item.id || `q${index + 1}`,
    label: item.label?.trim() || `问题 ${index + 1}`,
    value: recommended,
    reason: item.reason?.trim() || "根据主题和调研结果给出的建议",
    options: options.slice(0, 3),
  };
}

function fallbackQuestions(
  audience: string,
  purpose: string,
  pageCount: number,
): ProjectAssumptions["questions"] {
  return [
    {
      id: "page_count",
      label: "内容页数",
      value: `${pageCount} 页左右`,
      reason: "在信息完整度与阅读节奏之间保持平衡",
      options: [`8–10 页`, `${pageCount} 页左右`, "15–16 页"],
    },
    {
      id: "audience",
      label: "核心受众",
      value: audience,
      reason: "根据主题与调研语境推断的主要听众",
      options: [audience, "管理层与决策者", "客户与合作伙伴"],
    },
    {
      id: "purpose",
      label: "演示目标",
      value: purpose,
      reason: "用明确目标约束整份演示的论证顺序",
      options: [purpose, "建立认知并解释方案", "促成评审或业务决策"],
    },
    {
      id: "comparison",
      label: "竞品对比",
      value: "仅在有可靠资料时加入",
      reason: "避免为了完整性制造无依据的对比",
      options: ["不需要", "仅在有可靠资料时加入", "作为重点章节"],
    },
  ];
}

export async function generateOutline(projectId: string) {
  const project = getProject(projectId);
  const text = requireTextConfig();
  const assumptions = parseAssumptions(project);
  const sources = JSON.parse(project.init_sources_json || "[]") as SearchHit[];

  updateProject(projectId, { stage: "outline", status: "running" });
  log(projectId, "正在生成大纲结构板");

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
  log(projectId, "结构板已就绪", "后台继续按页检索和出稿", "success");
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
      const sectionChanged = current.section_title !== item.sectionTitle;
      const contentChanged = titleChanged || bulletChanged || typeChanged || sectionChanged;
      updatePage(current.id, {
        page_code: pageCode(index),
        sort_order: index,
        page_type: item.pageType,
        section_title: item.sectionTitle,
        title: item.title,
        bullets_json: JSON.stringify(bullets),
        ...(contentChanged ? invalidateFrom("search") : { needs_rerun: 0 }),
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
  assertPageBelongsToProject(projectId, page);
  if (page.search_status !== "ready" || page.summary_status !== "ready") {
    await researchPage(projectId, pageId);
    page = getPage(pageId);
  }
  if (page.draft_status !== "ready") {
    await draftPage(projectId, pageId, pageInstructions.get(pageId)?.draft);
    clearPageInstruction(pageId, "draft");
    page = getPage(pageId);
  }
  if (page.design_status !== "ready") {
    await designPage(projectId, pageId, pageInstructions.get(pageId)?.design);
    clearPageInstruction(pageId, "design");
  }
  updatePage(pageId, { needs_rerun: 0 });
}

function assertPageBelongsToProject(projectId: string, page: PageRow) {
  if (page.project_id !== projectId) {
    throw new Error("页面不属于当前项目");
  }
}

function queuePageInstruction(pageId: string, stage: "draft" | "design", instruction?: string) {
  if (!instruction?.trim()) return;
  pageInstructions.set(pageId, {
    ...pageInstructions.get(pageId),
    [stage]: instruction.trim(),
  });
}

function clearPageInstruction(pageId: string, stage: "draft" | "design") {
  const current = pageInstructions.get(pageId);
  if (!current) return;
  delete current[stage];
  if (current.draft || current.design) pageInstructions.set(pageId, current);
  else pageInstructions.delete(pageId);
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
    const found = await webSearch(search, query, {
      onProgress: reportSearchProgress(projectId, query, pageId),
      shouldCancel: () => cancelFlags.has(projectId),
    });
    assertNotCancelled(projectId);
    hits.push(...compactHits(found, 3));
    log(projectId, `R  ${query}`, `${found.length} 条`, "search", pageId);
  }
  const unique = dedupeHits(hits).slice(0, 8);
  assertNotCancelled(projectId);

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
      updatePage(page.id, invalidateFrom("design"));
    }
  }
  enqueuePipeline(projectId, { cancelRunning: true });
}

export async function applyAssumptionPatch(
  projectId: string,
  patch: Partial<ProjectAssumptions> & { rebuildOutline?: boolean },
) {
  const project = getProject(projectId);
  const current = parseAssumptions(project);
  const patchKeys = Object.keys(patch).filter((key) => key !== "rebuildOutline");
  const pageCount = Math.min(16, Math.max(8, Number(patch.pageCount ?? current.pageCount) || 12));
  const styleId = getStylePack(patch.styleId ?? current.styleId).id;
  const next: ProjectAssumptions = {
    ...current,
    ...patch,
    pageCount,
    audience: patch.audience?.trim() ?? current.audience,
    purpose: patch.purpose?.trim() ?? current.purpose,
    styleId,
    questions: patch.questions ?? current.questions,
  };
  const styleOnly =
    patchKeys.length === 1 &&
    patchKeys[0] === "styleId" &&
    styleId !== current.styleId &&
    !patch.rebuildOutline;

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

  log(projectId, "假设已更新，重算大纲及下游");
  enqueuePipeline(projectId, { rebuildOutline: true, cancelRunning: true });
}

export function confirmRequirements(
  projectId: string,
  input: Partial<ProjectAssumptions>,
) {
  const project = getProject(projectId);
  if (project.outline_json) {
    throw new Error("需求已经确认，请在工作台中修改项目假设");
  }
  const current = parseAssumptions(project);
  const questions = (input.questions ?? current.questions).map((question, index) => ({
    ...normalizeQuestion(question, index),
    value: question.value?.trim() || normalizeQuestion(question, index).value,
  }));
  if (questions.length === 0 || questions.some((question) => !question.value)) {
    throw new Error("请完成内容需求单后再提交");
  }
  const next: ProjectAssumptions = {
    pageCount: Math.min(16, Math.max(8, Number(input.pageCount ?? current.pageCount) || 12)),
    audience: input.audience?.trim() || current.audience,
    purpose: input.purpose?.trim() || current.purpose,
    styleId: getStylePack(input.styleId ?? current.styleId).id,
    questions,
  };
  updateProject(projectId, {
    assumptions_json: JSON.stringify(next),
    page_count_target: next.pageCount,
    style_id: next.styleId,
    status: "running",
    error_text: null,
  });
  log(projectId, "内容需求已确认", "开始生成大纲结构板", "success");
  enqueuePipeline(projectId, { rebuildOutline: true, cancelRunning: true });
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
  assertPageBelongsToProject(projectId, page);
  const nextTitle = input.title ?? page.title;
  const nextBullets = input.bullets ?? JSON.parse(page.bullets_json || "[]") as string[];
  const contentChanged =
    nextTitle !== page.title || JSON.stringify(nextBullets) !== page.bullets_json;
  updatePage(pageId, {
    title: nextTitle,
    bullets_json: JSON.stringify(nextBullets),
    speaker_notes: input.speakerNotes ?? page.speaker_notes,
  });

  if (!contentChanged && !input.regenerate && !input.instruction) {
    return;
  }

  const regen = contentChanged ? "all" : (input.regenerate ?? "all");
  if (regen === "research" || regen === "all") {
    updatePage(pageId, invalidateFrom("search"));
    queuePageInstruction(pageId, "draft", input.instruction);
    enqueuePipeline(projectId, { cancelRunning: true });
    return;
  }
  if (regen === "draft") {
    updatePage(pageId, invalidateFrom("draft"));
    queuePageInstruction(pageId, "draft", input.instruction);
    enqueuePipeline(projectId, { cancelRunning: true });
    return;
  }
  if (regen === "design") {
    updatePage(pageId, invalidateFrom("design"));
    queuePageInstruction(pageId, "design", input.instruction);
    enqueuePipeline(projectId, { cancelRunning: true });
  }
}

export async function applyPageOrder(projectId: string, orderedPageIds: string[]) {
  const before = listPages(projectId);
  const previousOrder = new Map(before.map((page) => [page.id, page.sort_order]));
  const reordered = reorderPages(projectId, orderedPageIds);
  const changed = reordered.filter((page) => previousOrder.get(page.id) !== page.sort_order);
  for (const page of changed) {
    updatePage(page.id, invalidateFrom("search"));
  }
  if (changed.length) {
    log(projectId, "页面顺序已更新", `重算 ${changed.length} 页的下游内容`, "success");
    enqueuePipeline(projectId, { cancelRunning: true });
  }
}
