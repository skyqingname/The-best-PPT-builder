import { emitProjectChange } from "./events-bus";
import { ensureDeckPlan } from "./deck-plan";
import { extractSvg, type LlmProgressUpdate } from "./llm";
import { invalidateFrom } from "./invalidation";
import { generateJson } from "./model-gateway";
import { flattenOutline, pageCode, pagesToOutline, parseOutline } from "./outline";
import {
  designPage,
  draftPage,
  prepareFixedPageEvidence,
  researchPage,
  type PageGenerationRuntime,
} from "./page-generation";
import {
  ASSUMPTIONS_SYSTEM,
  OUTLINE_SYSTEM,
  PAGE_PATCH_SYSTEM,
  STRUCTURE_CHAT_SYSTEM,
} from "./prompts";
import {
  createArtifactId,
  getLatestStructureProposal,
  listStructureProposals,
  getReferenceState,
  markDeckPlanStale,
  saveReferenceState,
  saveStructureProposal,
  updateStructureProposal,
} from "./project-artifacts";
import { analyzeReferenceFile } from "./reference-assets";
import { compactHits, webSearch } from "./search";
import { requireSearch, requireTextConfig } from "./settings";
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
  PageType,
  PptOutline,
  ProjectAssumptions,
  SearchHit,
  StructureChatScope,
  StructureProposal,
} from "./types";

const running = new Set<string>();
const cancelFlags = new Set<string>();
const rerunRequests = new Set<string>();
const outlineRebuildRequests = new Set<string>();
const pageInstructions = new Map<string, { draft?: string; design?: string }>();
const activeControllers = new Map<string, AbortController>();
const pageMessages = new Map<string, Array<{
  pageId: string;
  message: string;
  surface: "search" | "draft" | "design";
}>>();
const structureMessages = new Map<string, Array<{
  message: string;
  scope: StructureChatScope;
  scopeId: string;
}>>();
const referenceAnalysisRequests = new Set<string>();
const artifactAuditFingerprints = new Map<string, string>();

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
  if (cancelFlags.has(projectId) || activeControllers.get(projectId)?.signal.aborted) {
    throw new Error("CANCELLED");
  }
}

function projectSignal(projectId: string): AbortSignal {
  const signal = activeControllers.get(projectId)?.signal;
  if (!signal) throw new Error("项目 worker 尚未启动");
  return signal;
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

function reportModelRetry(projectId: string, label: string, pageId?: string) {
  return ({ attempt, maxAttempts, delayMs }: {
    attempt: number;
    maxAttempts: number;
    delayMs: number;
  }) => {
    log(
      projectId,
      `模型繁忙，${Math.ceil(delayMs / 1000)} 秒后重试`,
      `${label} · 第 ${attempt} / ${maxAttempts} 次`,
      "status",
      pageId,
    );
  };
}

export function requestCancel(projectId: string) {
  cancelFlags.add(projectId);
  activeControllers.get(projectId)?.abort();
  updateProject(projectId, { status: "paused" });
  touch(projectId);
}

export function enqueuePageMessage(
  projectId: string,
  input: { pageId: string; message: string; surface: "search" | "draft" | "design" },
) {
  getProject(projectId);
  const page = getPage(input.pageId);
  assertPageBelongsToProject(projectId, page);
  const queue = pageMessages.get(projectId) ?? [];
  queue.push({ ...input, message: input.message.trim() });
  pageMessages.set(projectId, queue);
  log(projectId, "已收到改稿要求", page.title, "status", page.id);
  enqueuePipeline(projectId, { cancelRunning: true });
}

export function enqueueStructureMessage(
  projectId: string,
  input: { message: string; scope: StructureChatScope; scopeId?: string },
) {
  getProject(projectId);
  const queue = structureMessages.get(projectId) ?? [];
  queue.push({
    message: input.message.trim(),
    scope: input.scope,
    scopeId: input.scopeId?.trim() ?? "",
  });
  structureMessages.set(projectId, queue);
  log(projectId, "结构对话", input.message.trim(), "structure-chat-user");
  enqueuePipeline(projectId, { cancelRunning: true });
}

export function enqueueReferenceAnalysis(projectId: string) {
  referenceAnalysisRequests.add(projectId);
  enqueuePipeline(projectId, { cancelRunning: true });
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
    const controller = new AbortController();
    activeControllers.set(projectId, controller);
    try {
      await runPendingPageMessages(projectId);
      await runPendingStructureMessages(projectId);
      if (referenceAnalysisRequests.delete(projectId)) {
        try {
          await analyzeReferenceFile(projectId, referenceAnalysisRuntime(projectId, controller.signal));
        } catch (error) {
          if (controller.signal.aborted || (error instanceof Error && error.message === "CANCELLED")) {
            throw error;
          }
          updateProject(projectId, { stage: "style_reference", status: "paused", error_text: null });
        }
      }
      if (outlineRebuildRequests.delete(projectId)) {
        await generateOutline(projectId, controller.signal);
      }
      await runPipeline(projectId, controller.signal);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === "CANCELLED" || controller.signal.aborted) {
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
    } finally {
      if (activeControllers.get(projectId) === controller) {
        activeControllers.delete(projectId);
      }
    }
  }
}

async function runPipeline(projectId: string, signal: AbortSignal) {
  updateProject(projectId, { status: "running", error_text: null });
  auditProjectArtifacts(projectId);
  const project = getProject(projectId);
  if (!project.outline_json) {
    const assumptions = parseAssumptions(project);
    if (assumptions.questions.length === 0) {
      await runInitialResearch(projectId, signal);
    } else {
      updateProject(projectId, { stage: "requirements", status: "paused" });
    }
    return;
  }
  await runPendingPages(projectId, signal);
  const pages = listPages(projectId);
  const allDesigned = pages.every((page) => page.design_status === "ready");
  if (allDesigned && pages.length > 0) {
    updateProject(projectId, { stage: "done", status: "completed" });
    log(projectId, "PPT设计稿已就绪", `共 ${pages.length} 页`, "success");
  } else {
    updateProject(projectId, { status: "paused" });
  }
}

export function auditProjectArtifacts(projectId: string): {
  repaired: number;
  invalid: number;
} {
  const pages = listPages(projectId);
  const fingerprint = artifactFingerprint(pages);
  if (artifactAuditFingerprints.get(projectId) === fingerprint) {
    return { repaired: 0, invalid: 0 };
  }

  let repaired = 0;
  let invalid = 0;
  let earliestInvalidStage: "draft" | "design" | null = null;
  for (const page of pages) {
    const patch: Partial<PageRow> = {};
    let draftInvalid = false;

    if (page.draft_status === "ready") {
      try {
        const normalized = extractSvg(page.draft_svg);
        if (normalized !== page.draft_svg) {
          patch.draft_svg = normalized;
          repaired += 1;
        }
      } catch {
        draftInvalid = true;
        patch.draft_svg = "";
        patch.draft_status = "stale";
        patch.design_svg = "";
        patch.design_status = "stale";
        earliestInvalidStage = "draft";
        invalid += 1;
      }
    }

    if (!draftInvalid && page.design_status === "ready") {
      try {
        const normalized = extractSvg(page.design_svg);
        if (normalized !== page.design_svg) {
          patch.design_svg = normalized;
          repaired += 1;
        }
      } catch {
        patch.design_svg = "";
        patch.design_status = "stale";
        earliestInvalidStage ??= "design";
        invalid += 1;
      }
    }

    if (Object.keys(patch).length > 0) updatePage(page.id, patch);
  }

  if (invalid > 0) {
    const project = getProject(projectId);
    if (project.status === "completed") {
      updateProject(projectId, {
        stage: earliestInvalidStage ?? "design",
        status: "paused",
        error_text: `检测到 ${invalid} 个不可渲染稿件，已移出就绪状态；点击继续可重新生成`,
      });
    }
    log(projectId, "检测到不可渲染稿件", `${invalid} 页已等待重新生成`, "error");
  } else if (repaired > 0) {
    log(projectId, "已自动修复 SVG 输出", `${repaired} 个稿件已恢复为可渲染根节点`, "success");
  }

  artifactAuditFingerprints.set(projectId, artifactFingerprint(listPages(projectId)));
  return { repaired, invalid };
}

function artifactFingerprint(pages: PageRow[]): string {
  return pages
    .map((page) => [
      page.id,
      page.updated_at,
      page.draft_status,
      page.design_status,
      page.draft_svg.length,
      page.design_svg.length,
    ].join(":"))
    .join("|");
}

async function runInitialResearch(projectId: string, signal: AbortSignal) {
  const project = getProject(projectId);
  const text = requireTextConfig();
  const search = requireSearch();

  updateProject(projectId, { stage: "init" });
  log(projectId, "开始需求调研", project.request_text);

  const researchTask = JSON.stringify({
    topic: project.request_text,
    objective: "为 PPT 需求确认与大纲提供可核验的项目级背景资料",
    dimensions: ["主体与定位", "核心业务或主题事实", "市场与行业背景", "公开案例或数据"],
    instruction: "一次完成多维检索，优先选择主体官网、权威机构和可信媒体来源",
  });
  const initHits = await webSearch(search, researchTask, {
    onProgress: reportSearchProgress(projectId, project.request_text),
    shouldCancel: () => cancelFlags.has(projectId),
    signal,
  });
  assertNotCancelled(projectId);
  updateProject(projectId, { init_sources_json: JSON.stringify(compactHits(initHits, 12)) });

  const style = pickStyleForTopic(project.request_text);
  const assumptionPayload = await generateJson<{
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
  }>(text, [
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
  ], {
    signal,
    onRetry: reportModelRetry(projectId, "生成内容需求单"),
  });
  assertNotCancelled(projectId);
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

export async function generateOutline(projectId: string, signal = projectSignal(projectId)) {
  const project = getProject(projectId);
  const text = requireTextConfig();
  const assumptions = parseAssumptions(project);
  const sources = JSON.parse(project.init_sources_json || "[]") as SearchHit[];

  updateProject(projectId, { stage: "outline", status: "running" });
  log(projectId, "正在生成大纲结构板");

  const system = OUTLINE_SYSTEM.replace(
    "{{PAGE_REQUIREMENTS}}",
    `整份 PPT 总页数约 ${assumptions.pageCount} 页。系统会把每个 parts[].part_title 自动实体化为一张章节分隔页，因此总页数 = 1 张封面 + 1 张目录 + parts 数量对应的章节页 + parts[].pages 的全部内容页 + 1 张结尾页。请按这个公式控制数量。`,
  );
  const outlinePayload = await generateJson<unknown>(text, [
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
  ], {
    signal,
    onRetry: reportModelRetry(projectId, "生成结构板"),
  });
  assertNotCancelled(projectId);
  const outline = parseOutline(JSON.stringify(outlinePayload));
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

async function runPendingPageMessages(projectId: string) {
  const queue = pageMessages.get(projectId);
  if (!queue?.length) return;
  while (queue.length) {
    assertNotCancelled(projectId);
    const command = queue[0];
    if (!command) break;
    try {
      const page = getPage(command.pageId);
      assertPageBelongsToProject(projectId, page);
      const project = getProject(projectId);
      const patch = await generateJson<{
        title?: string | null;
        content_outline?: string[] | null;
        speaker_notes?: string | null;
        render_instruction?: string;
      }>(requireTextConfig(), [
        { role: "system", content: PAGE_PATCH_SYSTEM },
        {
          role: "user",
          content: JSON.stringify({
            message: command.message,
            surface: command.surface,
            page: {
              title: page.title,
              bullets: JSON.parse(page.bullets_json || "[]"),
              speaker_notes: page.speaker_notes,
            },
            assumptions: parseAssumptions(project),
          }),
        },
      ], {
        signal: projectSignal(projectId),
        onRetry: reportModelRetry(projectId, "解析改稿要求", page.id),
      });
      const regenerate = command.surface === "design"
        ? "design"
        : command.surface === "draft"
          ? "draft"
          : "all";
      await applyPageEdit(projectId, page.id, {
        title: patch.title || undefined,
        bullets: patch.content_outline || undefined,
        speakerNotes: patch.speaker_notes || undefined,
        instruction: patch.render_instruction || command.message,
        regenerate,
      }, { schedule: false });
      queue.shift();
    } catch (error) {
      if (projectSignal(projectId).aborted || (error instanceof Error && error.message === "CANCELLED")) {
        throw error;
      }
      queue.shift();
      log(
        projectId,
        "当前页改稿失败",
        error instanceof Error ? error.message : "模型没有返回可应用的修改",
        "error",
        command.pageId,
      );
    }
  }
  if (!queue.length) pageMessages.delete(projectId);
}

async function runPendingStructureMessages(projectId: string) {
  const queue = structureMessages.get(projectId);
  if (!queue?.length) return;
  while (queue.length) {
    assertNotCancelled(projectId);
    const command = queue[0];
    if (!command) break;
    try {
      const pages = listPages(projectId);
      const project = getProject(projectId);
      const payload = await generateJson<{
        summary?: string;
        pages?: Array<{
          id?: string;
          page_type?: string;
          section_title?: string | null;
          title?: string;
          content_outline?: string[];
        }>;
      }>(requireTextConfig(), [
        { role: "system", content: STRUCTURE_CHAT_SYSTEM },
        {
          role: "user",
          content: JSON.stringify({
            message: command.message,
            scope: command.scope,
            scope_id: command.scopeId,
            topic: project.request_text,
            assumptions: parseAssumptions(project),
            pages: pages.map((page) => ({
              id: page.id,
              page_type: page.page_type,
              section_title: page.section_title,
              title: page.title,
              content_outline: JSON.parse(page.bullets_json || "[]"),
            })),
          }),
        },
      ], {
        signal: projectSignal(projectId),
        onRetry: reportModelRetry(projectId, "解析结构修改要求"),
      });
      assertNotCancelled(projectId);
      const proposal = normalizeStructureProposal(projectId, command, payload, pages);
      saveStructureProposal(projectId, proposal);
      log(projectId, "结构修改提案已生成", proposal.summary, "structure-chat-assistant");
      queue.shift();
    } catch (error) {
      if (projectSignal(projectId).aborted || (error instanceof Error && error.message === "CANCELLED")) {
        throw error;
      }
      queue.shift();
      log(
        projectId,
        "结构修改未生成提案",
        error instanceof Error ? error.message : "模型没有返回可应用的结构",
        "structure-chat-assistant",
      );
    }
  }
  if (!queue.length) structureMessages.delete(projectId);
}

function normalizeStructureProposal(
  projectId: string,
  command: { message: string; scope: StructureChatScope; scopeId: string },
  payload: {
    summary?: string;
    pages?: Array<{
      id?: string;
      page_type?: string;
      section_title?: string | null;
      title?: string;
      content_outline?: string[];
    }>;
  },
  current: PageRow[],
): StructureProposal {
  const validTypes = new Set<PageType>(["cover", "toc", "section", "content", "end"]);
  const currentById = new Map(current.map((page) => [page.id, page]));
  const pages = (payload.pages ?? []).slice(0, 24).map((item, index) => {
    const existing = item.id ? currentById.get(item.id) : undefined;
    const type = validTypes.has(item.page_type as PageType)
      ? item.page_type as PageType
      : existing?.page_type ?? "content";
    return {
      id: existing?.id ?? (item.id?.startsWith("new:") ? item.id : `new:${index + 1}`),
      pageType: type,
      sectionTitle: type === "content"
        ? cleanText(item.section_title ?? existing?.section_title ?? "") || null
        : type === "section"
          ? cleanText(item.title ?? existing?.title ?? "") || null
          : null,
      title: cleanText(item.title ?? existing?.title ?? "") || `未命名页面 ${index + 1}`,
      bullets: cleanStringList(item.content_outline ?? (
        existing ? JSON.parse(existing.bullets_json || "[]") as string[] : []
      )),
    };
  });
  validateProposedPages(pages);
  validateScope(command.scope, command.scopeId, pages, current);
  return {
    id: createArtifactId("proposal"),
    projectId,
    scope: command.scope,
    scopeId: command.scopeId,
    message: command.message,
    summary: cleanText(payload.summary) || "已根据要求调整演示结构",
    pages,
    status: "pending",
    createdAt: new Date().toISOString(),
    appliedAt: "",
  };
}

function validateProposedPages(pages: StructureProposal["pages"]) {
  if (pages.length < 5 || pages.length > 24) throw new Error("结构提案页数必须在 5 到 24 页之间");
  if (pages[0]?.pageType !== "cover" || pages[1]?.pageType !== "toc") {
    throw new Error("结构提案必须以封面、目录开场");
  }
  if (pages.at(-1)?.pageType !== "end") throw new Error("结构提案必须以结束页收束");
  if (pages.filter((page) => page.pageType === "cover").length !== 1
    || pages.filter((page) => page.pageType === "toc").length !== 1
    || pages.filter((page) => page.pageType === "end").length !== 1) {
    throw new Error("结构提案只能包含一个封面、目录和结束页");
  }
  const ids = pages.filter((page) => !page.id.startsWith("new:")).map((page) => page.id);
  if (new Set(ids).size !== ids.length) throw new Error("结构提案包含重复页面");
}

function validateScope(
  scope: StructureChatScope,
  scopeId: string,
  proposed: StructureProposal["pages"],
  current: PageRow[],
) {
  if (scope === "deck") return;
  const editable = new Set<string>();
  if (scope === "page") editable.add(scopeId);
  if (scope === "section") {
    current.forEach((page) => {
      if (page.id === scopeId || page.section_title === scopeId) editable.add(page.id);
    });
  }
  const proposedById = new Map(proposed.map((page) => [page.id, page]));
  for (const page of current) {
    if (editable.has(page.id)) continue;
    const next = proposedById.get(page.id);
    if (!next
      || next.title !== page.title
      || next.pageType !== page.page_type
      || next.sectionTitle !== page.section_title
      || JSON.stringify(next.bullets) !== page.bullets_json) {
      throw new Error("模型尝试修改所选范围之外的页面，请缩小要求后重试");
    }
  }
}

async function runPendingPages(projectId: string, signal: AbortSignal) {
  const runtime = pageGenerationRuntime(projectId, signal);
  for (const page of listPages(projectId)) {
    assertNotCancelled(projectId);
    if (page.search_status === "ready" && page.summary_status === "ready") continue;
    if (page.page_type === "content") await researchPage(projectId, page.id, runtime);
    else prepareFixedPageEvidence(projectId, page, runtime);
  }

  await ensureDeckPlan(projectId, {
    signal,
    assertActive: runtime.assertActive,
    log: (title, detail, kind) => runtime.log(title, detail, kind),
    onRetry: runtime.modelRetry("统一整套内容策划", ""),
  });

  for (const page of listPages(projectId)) {
    assertNotCancelled(projectId);
    if (page.draft_status === "ready") continue;
    await draftPage(projectId, page.id, pageInstructions.get(page.id)?.draft, runtime);
    clearPageInstruction(page.id, "draft");
  }

  const project = getProject(projectId);
  const reference = getReferenceState(projectId, project.style_id);
  const hasLegacyDesign = listPages(projectId).some((page) => page.design_status === "ready");
  if (reference.status !== "confirmed" && !hasLegacyDesign) {
    const alreadyWaiting = project.stage === "style_reference" && project.status === "paused";
    updateProject(projectId, { stage: "style_reference", status: "paused" });
    if (!alreadyWaiting) {
      log(projectId, "请确认设计参考", "选择内置风格或上传 PPT / PDF 后继续", "status");
    }
    return;
  }

  for (const page of listPages(projectId)) {
    assertNotCancelled(projectId);
    if (page.design_status === "ready") continue;
    await designPage(projectId, page.id, pageInstructions.get(page.id)?.design, runtime);
    clearPageInstruction(page.id, "design");
    updatePage(page.id, { needs_rerun: 0 });
  }
}

export async function runOnePage(
  projectId: string,
  pageId: string,
  signal = projectSignal(projectId),
) {
  const runtime = pageGenerationRuntime(projectId, signal);
  let page = getPage(pageId);
  assertPageBelongsToProject(projectId, page);
  if (page.search_status !== "ready" || page.summary_status !== "ready") {
    if (page.page_type === "content") await researchPage(projectId, pageId, runtime);
    else prepareFixedPageEvidence(projectId, page, runtime);
    page = getPage(pageId);
  }
  if (page.draft_status !== "ready") {
    await ensureDeckPlan(projectId, {
      signal,
      assertActive: runtime.assertActive,
      log: (title, detail, kind) => runtime.log(title, detail, kind),
      onRetry: runtime.modelRetry("统一整套内容策划", pageId),
    });
    await draftPage(projectId, pageId, pageInstructions.get(pageId)?.draft, runtime);
    clearPageInstruction(pageId, "draft");
    page = getPage(pageId);
  }
  if (page.design_status !== "ready") {
    await designPage(projectId, pageId, pageInstructions.get(pageId)?.design, runtime);
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

function pageGenerationRuntime(
  projectId: string,
  signal: AbortSignal,
): PageGenerationRuntime {
  return {
    signal,
    assertActive: () => assertNotCancelled(projectId),
    isCancelled: () => cancelFlags.has(projectId) || signal.aborted,
    log: (title, detail = "", kind = "info", pageId) => {
      log(projectId, title, detail, kind, pageId);
    },
    searchProgress: (query, pageId) => reportSearchProgress(projectId, query, pageId),
    modelRetry: (label, pageId) => reportModelRetry(projectId, label, pageId),
  };
}

function referenceAnalysisRuntime(projectId: string, signal: AbortSignal) {
  return {
    signal,
    assertActive: () => assertNotCancelled(projectId),
    log: (title: string, detail = "", kind = "info") => log(projectId, title, detail, kind),
    onRetry: reportModelRetry(projectId, "分析参考稿"),
  };
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
    requestCancel(projectId);
    const reference = getReferenceState(projectId, next.styleId);
    saveReferenceState(projectId, {
      ...reference,
      status: "pending",
      mode: "preset",
      styleId: next.styleId,
      colorPreference: "",
      profile: null,
      error: "",
      confirmedAt: "",
    });
    for (const page of listPages(projectId)) {
      if (page.draft_svg) updatePage(page.id, invalidateFrom("design"));
    }
    updateProject(projectId, {
      stage: "style_reference",
      status: "paused",
      error_text: null,
    });
    log(projectId, "视觉方向待确认", getStylePack(next.styleId).name, "status");
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
  options: { schedule?: boolean } = {},
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

  if (contentChanged) {
    markDeckPlanStale(projectId);
    updateProject(projectId, {
      outline_json: JSON.stringify(pagesToOutline(listPages(projectId).map(pageForOutline))),
    });
  }

  if (!contentChanged && !input.regenerate && !input.instruction) {
    return;
  }

  const regen = contentChanged ? "all" : (input.regenerate ?? "all");
  if (regen === "research" || regen === "all") {
    updatePage(pageId, invalidateFrom("search"));
    queuePageInstruction(pageId, "draft", input.instruction);
    if (options.schedule !== false) enqueuePipeline(projectId, { cancelRunning: true });
    return;
  }
  if (regen === "draft") {
    updatePage(pageId, invalidateFrom("draft"));
    queuePageInstruction(pageId, "draft", input.instruction);
    if (options.schedule !== false) enqueuePipeline(projectId, { cancelRunning: true });
    return;
  }
  if (regen === "design") {
    updatePage(pageId, invalidateFrom("design"));
    queuePageInstruction(pageId, "design", input.instruction);
    if (options.schedule !== false) enqueuePipeline(projectId, { cancelRunning: true });
  }
}

export async function applyPageOrder(projectId: string, orderedPageIds: string[]) {
  const before = listPages(projectId);
  const beforeById = new Map(before.map((page) => [page.id, page]));
  if (
    orderedPageIds.length !== before.length
    || new Set(orderedPageIds).size !== orderedPageIds.length
    || orderedPageIds.some((id) => !beforeById.has(id))
  ) {
    throw new Error("页面顺序与当前项目不匹配");
  }
  pagesToOutline(orderedPageIds.map((id) => pageForOutline(beforeById.get(id)!)));
  const previousOrder = new Map(before.map((page) => [page.id, page.sort_order]));
  const reordered = reorderPages(projectId, orderedPageIds);
  const changed = reordered.filter((page) => previousOrder.get(page.id) !== page.sort_order);
  for (const page of changed) {
    updatePage(page.id, invalidateFrom("draft"));
  }
  if (changed.length) {
    markDeckPlanStale(projectId);
    updateProject(projectId, {
      outline_json: JSON.stringify(pagesToOutline(listPages(projectId).map(pageForOutline))),
    });
    log(projectId, "页面顺序已更新", `保留资料，只重算 ${changed.length} 页的策划与设计`, "success");
    enqueuePipeline(projectId, { cancelRunning: true });
  }
}

export async function applyStructureProposal(projectId: string, proposalId: string) {
  const proposal = listStructureProposals(projectId).find((item) => item.id === proposalId);
  if (!proposal || proposal.status !== "pending") throw new Error("没有可应用的结构修改提案");
  validateProposedPages(proposal.pages);
  requestCancel(projectId);

  const before = listPages(projectId);
  const beforeById = new Map(before.map((page) => [page.id, page]));
  const finalIds: string[] = [];
  proposal.pages.forEach((item, index) => {
    const existing = beforeById.get(item.id);
    if (!existing) {
      const created = insertPage({
        projectId,
        pageCode: pageCode(index),
        sortOrder: index,
        pageType: item.pageType,
        sectionTitle: item.sectionTitle,
        title: item.title,
        bullets: item.bullets,
      });
      finalIds.push(created.id);
      return;
    }
    const contentChanged = existing.title !== item.title
      || existing.page_type !== item.pageType
      || existing.section_title !== item.sectionTitle
      || existing.bullets_json !== JSON.stringify(item.bullets);
    const orderChanged = existing.sort_order !== index;
    updatePage(existing.id, {
      page_type: item.pageType,
      section_title: item.sectionTitle,
      title: item.title,
      bullets_json: JSON.stringify(item.bullets),
      ...(contentChanged
        ? invalidateFrom("search")
        : orderChanged
          ? invalidateFrom("draft")
          : {}),
    });
    finalIds.push(existing.id);
  });
  deletePagesNotIn(projectId, finalIds);
  reorderPages(projectId, finalIds);
  const finalPages = listPages(projectId);
  const outline = pagesToOutline(finalPages.map(pageForOutline));
  updateProject(projectId, {
    title: outline.cover.title.slice(0, 40),
    outline_json: JSON.stringify(outline),
    page_count_target: finalPages.length,
    status: "running",
    error_text: null,
  });
  markDeckPlanStale(projectId);
  updateStructureProposal(projectId, proposal.id, {
    status: "applied",
    appliedAt: new Date().toISOString(),
  });
  log(projectId, "结构修改已应用", proposal.summary, "success");
  enqueuePipeline(projectId, { cancelRunning: true });
}

export function dismissStructureProposal(projectId: string, proposalId: string) {
  const proposal = listStructureProposals(projectId).find((item) => item.id === proposalId);
  if (!proposal || proposal.status !== "pending") throw new Error("没有可忽略的结构修改提案");
  updateStructureProposal(projectId, proposalId, { status: "dismissed" });
  log(projectId, "已忽略结构修改提案", proposal.summary, "status");
  touch(projectId);
}

export async function confirmDesignReference(projectId: string, input: {
  mode: "preset" | "upload";
  styleId?: string;
  colorPreference?: string;
}) {
  const project = getProject(projectId);
  const current = getReferenceState(projectId, project.style_id);
  const styleId = getStylePack(input.styleId ?? current.styleId ?? project.style_id).id;
  if (input.mode === "upload" && (current.status !== "ready" || !current.profile)) {
    throw new Error("参考稿尚未分析完成");
  }
  const changed = current.mode !== input.mode
    || current.styleId !== styleId
    || current.colorPreference !== (input.colorPreference?.trim() ?? "")
    || current.status !== "confirmed";
  const next = saveReferenceState(projectId, {
    ...current,
    mode: input.mode,
    styleId,
    colorPreference: input.colorPreference?.trim() ?? "",
    status: "confirmed",
    error: "",
    confirmedAt: new Date().toISOString(),
  });
  updateProject(projectId, { style_id: styleId, stage: "design", status: "running", error_text: null });
  if (changed) {
    for (const page of listPages(projectId)) {
      if (page.draft_status === "ready") updatePage(page.id, invalidateFrom("design"));
    }
  }
  log(projectId, "设计参考已确认", next.profile?.name || getStylePack(styleId).name, "success");
  enqueuePipeline(projectId, { cancelRunning: true });
}

function pageForOutline(page: PageRow) {
  return {
    pageType: page.page_type,
    sectionTitle: page.section_title,
    title: page.title,
    bullets: JSON.parse(page.bullets_json || "[]") as string[],
  };
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, 500) : "";
}

function cleanStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(cleanText).filter(Boolean).slice(0, 6)
    : [];
}
