"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import type {
  AssumptionsDTO,
  AssumptionQuestionDTO,
  PageDTO,
  ProjectDTO,
} from "@/lib/client-types";

type Surface = "search" | "draft" | "design";
type WorkspaceView = "structure" | "workbench";

const SURFACES: Array<{ id: Surface; label: string; icon: IconName }> = [
  { id: "search", label: "搜索", icon: "search" },
  { id: "draft", label: "初稿", icon: "file" },
  { id: "design", label: "设计稿", icon: "palette" },
];

export default function ProjectExperience({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [project, setProject] = useState<ProjectDTO | null>(null);
  const [view, setView] = useState<WorkspaceView>("structure");
  const [surface, setSurface] = useState<Surface>("design");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function refresh() {
    const response = await fetch("/api/projects/" + projectId);
    if (!response.ok) return;
    const data = (await response.json()) as ProjectDTO;
    setProject(data);
    setActiveId((current) => current ?? data.pages[0]?.id ?? null);
  }

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 1600);
    return () => window.clearInterval(timer);
  }, [projectId]);

  useEffect(() => {
    const source = new EventSource("/api/projects/" + projectId + "/events");
    source.onmessage = () => void refresh();
    return () => source.close();
  }, [projectId]);

  const page = useMemo(
    () => project?.pages.find((item) => item.id === activeId) ?? project?.pages[0] ?? null,
    [project, activeId],
  );

  async function postAction(payload: Record<string, unknown>): Promise<ProjectDTO | null> {
    setError("");
    const response = await fetch("/api/projects/" + projectId + "/actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) {
      setError(data.error || "操作失败");
      return null;
    }
    setProject(data as ProjectDTO);
    return data as ProjectDTO;
  }

  async function patchPage(pageId: string, input: { title: string; bullets: string[] }) {
    setError("");
    const response = await fetch("/api/projects/" + projectId + "/pages/" + pageId, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const data = await response.json();
    if (!response.ok) {
      setError(data.error || "页面更新失败");
      return false;
    }
    setProject((current) =>
      current
        ? { ...current, pages: current.pages.map((item) => (item.id === pageId ? data : item)) }
        : current,
    );
    return true;
  }

  async function movePage(pageId: string, direction: -1 | 1) {
    if (!project) return;
    const currentIndex = project.pages.findIndex((item) => item.id === pageId);
    const nextIndex = currentIndex + direction;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= project.pages.length) return;
    const pageIds = project.pages.map((item) => item.id);
    [pageIds[currentIndex], pageIds[nextIndex]] = [pageIds[nextIndex], pageIds[currentIndex]];
    await postAction({ type: "reorderPages", pageIds });
  }

  async function sendChat() {
    if (!page || !message.trim()) return;
    const current = message.trim();
    setMessage("");
    await postAction({ type: "chat", pageId: page.id, message: current, surface });
  }

  if (!project) return <LoadingScreen label="正在打开项目工作台" />;

  if (!project.outlineReady) {
    return (
      <RequirementsFlow
        project={project}
        error={error}
        onBack={() => router.push("/")}
        onSettings={() => router.push("/settings")}
        onSubmit={async (assumptions) =>
          Boolean(await postAction({ type: "confirmRequirements", assumptions }))
        }
        onResume={() => void postAction({ type: "resume" })}
      />
    );
  }

  if (view === "structure") {
    return (
      <StructureBoard
        project={project}
        error={error}
        onBack={() => router.push("/")}
        onOpen={(id) => {
          setActiveId(id);
          setView("workbench");
          setSurface("design");
        }}
        onEnter={() => {
          setActiveId((current) => current ?? project.pages[0]?.id ?? null);
          setView("workbench");
        }}
        onToggleRun={() =>
          void postAction({ type: project.status === "running" ? "cancel" : "resume" })
        }
        onEdit={patchPage}
        onMove={(pageId, direction) => void movePage(pageId, direction)}
      />
    );
  }

  return (
    <Workbench
      project={project}
      page={page}
      surface={surface}
      message={message}
      error={error}
      onMessage={setMessage}
      onSurface={setSurface}
      onSelect={setActiveId}
      onStructure={() => setView("structure")}
      onBack={() => router.push("/")}
      onSettings={() => router.push("/settings")}
      onPresent={() => router.push("/projects/" + projectId + "/present")}
      onToggleRun={() =>
        void postAction({ type: project.status === "running" ? "cancel" : "resume" })
      }
      onSend={() => void sendChat()}
      onAssumptions={(assumptions) =>
        void postAction({ type: "updateAssumptions", assumptions })
      }
      onNotes={(speakerNotes) => {
        if (!page) return;
        void fetch("/api/projects/" + projectId + "/pages/" + page.id, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ speakerNotes }),
        });
      }}
    />
  );
}

function RequirementsFlow({
  project,
  error,
  onBack,
  onSettings,
  onSubmit,
  onResume,
}: {
  project: ProjectDTO;
  error: string;
  onBack: () => void;
  onSettings: () => void;
  onSubmit: (assumptions: AssumptionsDTO) => Promise<boolean>;
  onResume: () => void;
}) {
  const [draft, setDraft] = useState(project.assumptions);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [customIds, setCustomIds] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const snapshot = JSON.stringify(project.assumptions);

  useEffect(() => {
    if (!dirty) setDraft(project.assumptions);
  }, [snapshot, dirty]);

  useEffect(() => {
    if (project.status === "failed") setSubmitting(false);
  }, [project.status]);

  const ready = project.requirementsReady && draft.questions.length > 0;
  const question = draft.questions[questionIndex];
  const allAnswered = draft.questions.every((item) => item.value.trim());

  function updateMeta(patch: Partial<AssumptionsDTO>) {
    setDirty(true);
    setDraft((current) => ({ ...current, ...patch }));
  }

  function setQuestionValue(target: AssumptionQuestionDTO, value: string, custom = false) {
    setDirty(true);
    setCustomIds((current) =>
      custom
        ? Array.from(new Set([...current, target.id]))
        : current.filter((id) => id !== target.id),
    );
    setDraft((current) => {
      const next: AssumptionsDTO = {
        ...current,
        questions: current.questions.map((item) =>
          item.id === target.id ? { ...item, value } : item,
        ),
      };
      if (/页数|篇幅/.test(target.label)) {
        const numbers = value.match(/\d+/g)?.map(Number) ?? [];
        if (numbers.length) next.pageCount = Math.min(16, Math.max(8, numbers.at(-1) ?? 12));
      }
      if (/受众|听众|对象/.test(target.label) && value) next.audience = value;
      if (/目的|目标/.test(target.label) && value) next.purpose = value;
      return next;
    });
  }

  async function submit() {
    if (!allAnswered) return;
    setSubmitting(true);
    const saved = await onSubmit(draft);
    if (!saved) setSubmitting(false);
  }

  return (
    <div className="requirements-shell min-h-dvh text-[#15233a]">
      <header className="flex h-[62px] items-center justify-between border-b border-[#e8edf5] bg-white/90 px-4 backdrop-blur md:px-7">
        <button className="ui-icon-button" onClick={onBack} aria-label="返回首页">
          <Icon name="back" size={18} />
        </button>
        <div className="min-w-0 px-4 text-center">
          <div className="truncate text-[14px] font-semibold md:text-[15px]">{project.title}</div>
          <div className="mt-0.5 text-[10px] font-medium tracking-[0.16em] text-[#9aa8ba]">
            REQUIREMENT BRIEF
          </div>
        </div>
        <button className="ui-icon-button" onClick={onSettings} aria-label="打开设置">
          <Icon name="settings" size={18} />
        </button>
      </header>

      <main className="mx-auto w-full max-w-[760px] px-4 py-8 md:px-6 md:py-12">
        <div className="ml-auto max-w-[78%] animate-rise">
          <div className="rounded-[24px_24px_7px_24px] bg-[#2f80ff] px-5 py-3.5 text-[15px] leading-6 text-white shadow-[0_12px_28px_rgba(47,128,255,0.22)] md:text-[16px]">
            {project.requestText}
          </div>
          <div className="mt-2 pr-1 text-right text-[11px] text-[#9aabc1]">你的项目主题</div>
        </div>

        <div className="mt-9 space-y-5">
          <TimelineLine
            complete={project.researchSources.length > 0 || ready}
            active={!ready}
            label={ready ? "背景调研完成" : "正在进行背景调研，收集相关资料…"}
          />

          {!ready ? (
            <ResearchLoading project={project} onResume={onResume} />
          ) : (
            <>
              <ResearchReceipt project={project} />
              <p className="animate-rise text-[16px] leading-7 text-[#34445b] md:text-[17px]">
                背景调研已完成。下面是影响大纲结构的关键需求，推荐项已经代选，你可以直接提交或逐项调整。
              </p>

              <section className="animate-rise overflow-hidden rounded-[24px] border border-[#cfe0fb] bg-white shadow-[0_18px_54px_rgba(30,80,140,0.09)]">
                <div className="flex items-center justify-between border-b border-[#dbe8fb] bg-[#eef5ff] px-5 py-4">
                  <div className="flex items-center gap-3 text-[15px] font-semibold text-[#1765dc]">
                    <span className="grid h-8 w-8 place-items-center rounded-full bg-[#2f80ff] text-white">
                      <Icon name="target" size={17} />
                    </span>
                    内容需求单
                  </div>
                  <span className="text-[14px] font-semibold text-[#2f80ff]">
                    {questionIndex + 1}/{draft.questions.length}
                  </span>
                </div>

                <div className="px-5 py-5 md:px-6 md:py-6">
                  <details className="mb-5 rounded-[14px] border border-[#e8eef7] bg-[#f9fbfe]">
                    <summary className="cursor-pointer list-none px-4 py-3 text-[12px] font-medium text-[#6f8199]">
                      基础设定 · {draft.pageCount} 页 · {draft.audience}
                    </summary>
                    <div className="grid gap-3 border-t border-[#e8eef7] p-4 md:grid-cols-[110px_1fr]">
                      <label className="text-[11px] text-[#7c8da4]">
                        总页数
                        <input
                          type="number"
                          min={8}
                          max={16}
                          value={draft.pageCount}
                          onChange={(event) => updateMeta({ pageCount: Number(event.target.value) })}
                          className="form-field mt-1"
                        />
                      </label>
                      <label className="text-[11px] text-[#7c8da4]">
                        核心受众
                        <input
                          value={draft.audience}
                          onChange={(event) => updateMeta({ audience: event.target.value })}
                          className="form-field mt-1"
                        />
                      </label>
                      <label className="text-[11px] text-[#7c8da4] md:col-span-2">
                        演示目标
                        <input
                          value={draft.purpose}
                          onChange={(event) => updateMeta({ purpose: event.target.value })}
                          className="form-field mt-1"
                        />
                      </label>
                    </div>
                  </details>

                  {question && (
                    <div key={question.id} className="animate-question">
                      <div className="text-[12px] font-semibold text-[#2f80ff]">
                        问题 {questionIndex + 1}
                      </div>
                      <h2 className="mt-1.5 text-[20px] font-semibold tracking-[-0.02em] text-[#17243a]">
                        {question.label}
                      </h2>
                      {question.reason && (
                        <p className="mt-2 text-[12px] leading-5 text-[#8998ac]">
                          推荐依据：{question.reason}
                        </p>
                      )}
                      <div className="mt-5 grid gap-2.5 md:grid-cols-2">
                        {question.options.map((option, index) => {
                          const active = question.value === option && !customIds.includes(question.id);
                          return (
                            <button
                              key={option}
                              type="button"
                              onClick={() => setQuestionValue(question, option)}
                              className={cx(
                                "requirement-option",
                                active && "requirement-option-active",
                              )}
                            >
                              <span className="w-5 shrink-0 font-semibold opacity-75">
                                {String.fromCharCode(65 + index)}
                              </span>
                              <span className="truncate">{option}</span>
                              {active && <Icon name="check" size={16} />}
                            </button>
                          );
                        })}
                        <button
                          type="button"
                          onClick={() => setQuestionValue(question, "", true)}
                          className={cx(
                            "requirement-option",
                            customIds.includes(question.id) && "requirement-option-active",
                          )}
                        >
                          <span className="w-5 shrink-0 font-semibold opacity-75">
                            {String.fromCharCode(65 + question.options.length)}
                          </span>
                          <span>自定义</span>
                        </button>
                      </div>
                      {customIds.includes(question.id) && (
                        <input
                          autoFocus
                          value={question.value}
                          onChange={(event) => setQuestionValue(question, event.target.value, true)}
                          placeholder="输入你的答案"
                          className="form-field mt-3"
                        />
                      )}
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between border-t border-[#edf1f7] px-5 py-4">
                  <div className="flex gap-2">
                    <button
                      className="ui-icon-button"
                      disabled={questionIndex === 0}
                      onClick={() => setQuestionIndex((current) => Math.max(0, current - 1))}
                      aria-label="上一题"
                    >
                      <Icon name="back" size={16} />
                    </button>
                    <button
                      className="ui-icon-button"
                      disabled={questionIndex === draft.questions.length - 1}
                      onClick={() =>
                        setQuestionIndex((current) =>
                          Math.min(draft.questions.length - 1, current + 1),
                        )
                      }
                      aria-label="下一题"
                    >
                      <Icon name="arrow" size={16} />
                    </button>
                  </div>
                  {questionIndex === draft.questions.length - 1 ? (
                    <button
                      disabled={!allAnswered || submitting}
                      onClick={() => void submit()}
                      className="primary-button"
                    >
                      {submitting ? "正在生成结构板…" : "提交需求单"}
                      {!submitting && <Icon name="arrow" size={15} />}
                    </button>
                  ) : (
                    <button
                      disabled={!question?.value.trim()}
                      onClick={() => setQuestionIndex((current) => current + 1)}
                      className="primary-button"
                    >
                      下一题
                      <Icon name="arrow" size={15} />
                    </button>
                  )}
                </div>
              </section>
            </>
          )}
          {(error || project.errorText) && (
            <div className="rounded-[14px] border border-red-200 bg-red-50 px-4 py-3 text-[12px] text-red-700">
              {error || project.errorText}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function ResearchLoading({ project, onResume }: { project: ProjectDTO; onResume: () => void }) {
  const failed = project.status === "failed";
  const paused = project.status === "paused" && !project.requirementsReady;
  return (
    <div className="rounded-[22px] border border-[#e4ebf5] bg-white p-5 shadow-[0_14px_40px_rgba(30,64,110,0.07)]">
      <div className="flex items-center gap-3">
        <span className={cx("research-pulse", (failed || paused) && "bg-amber-400")} />
        <div>
          <div className="text-[14px] font-semibold">
            {failed ? "调研流程遇到问题" : paused ? "调研已暂停" : "Agent 正在建立主题背景"}
          </div>
          <div className="mt-1 text-[12px] text-[#8292a7]">
            {project.events.at(-1)?.title || "规划检索词并筛选可靠来源"}
          </div>
        </div>
      </div>
      <div className="mt-5 grid grid-cols-3 gap-2">
        {[0, 1, 2].map((index) => (
          <div key={index} className="h-2 overflow-hidden rounded-full bg-[#edf2f8]">
            <div
              className="h-full rounded-full bg-[#4c91ff] transition-all"
              style={{ width: index === 0 ? "100%" : index === 1 ? "64%" : "22%" }}
            />
          </div>
        ))}
      </div>
      {(failed || paused) && (
        <button onClick={onResume} className="secondary-button mt-5">
          继续调研
        </button>
      )}
    </div>
  );
}

function ResearchReceipt({ project }: { project: ProjectDTO }) {
  return (
    <div className="animate-rise overflow-hidden rounded-[18px] border border-[#dbe8fb] bg-[#f3f8ff]">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2 text-[13px] font-semibold text-[#255fba]">
          <span className="grid h-6 w-6 place-items-center rounded-full bg-[#2f80ff] text-white">
            <Icon name="check" size={14} />
          </span>
          背景调研完成
        </div>
        <span className="rounded-full bg-white px-2 py-1 text-[10px] font-semibold text-[#2f80ff]">
          {project.researchSources.length} 条资料
        </span>
      </div>
      <div className="border-t border-[#dbe8fb] bg-white/70 px-4 py-2.5">
        {project.researchSources.slice(0, 2).map((source) => (
          <a
            key={source.url}
            href={source.url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 py-1.5 text-[11px] text-[#6f8097] hover:text-[#2f80ff]"
          >
            <Icon name="search" size={13} />
            <span className="truncate">{source.title}</span>
          </a>
        ))}
      </div>
    </div>
  );
}

function TimelineLine({
  complete,
  active,
  label,
}: {
  complete: boolean;
  active: boolean;
  label: string;
}) {
  return (
    <div className="flex items-center gap-3 text-[14px] text-[#7c90a9]">
      <span
        className={cx(
          "grid h-8 w-8 shrink-0 place-items-center rounded-full",
          complete ? "bg-[#e8f2ff] text-[#2f80ff]" : "bg-[#eef2f7] text-[#98a6b8]",
        )}
      >
        {complete ? <Icon name="check" size={16} /> : <span className={cx(active && "research-pulse")} />}
      </span>
      <span>{label}</span>
    </div>
  );
}

function StructureBoard({
  project,
  error,
  onBack,
  onOpen,
  onEnter,
  onToggleRun,
  onEdit,
  onMove,
}: {
  project: ProjectDTO;
  error: string;
  onBack: () => void;
  onOpen: (id: string) => void;
  onEnter: () => void;
  onToggleRun: () => void;
  onEdit: (pageId: string, input: { title: string; bullets: string[] }) => Promise<boolean>;
  onMove: (pageId: string, direction: -1 | 1) => void;
}) {
  const [editing, setEditing] = useState<PageDTO | null>(null);
  const groups = useMemo(() => groupPages(project.pages), [project.pages]);

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-[#f6f8fb] text-[#17243a]">
      <header className="flex h-[64px] shrink-0 items-center justify-between border-b border-[#e6eaf0] bg-white px-4 md:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <button className="ui-icon-button" onClick={onBack} aria-label="返回首页">
            <Icon name="back" size={18} />
          </button>
          <div className="min-w-0">
            <div className="truncate text-[14px] font-semibold">{project.title}</div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[10px] font-medium text-[#8a98aa]">
              <span className={cx("h-1.5 w-1.5 rounded-full", project.status === "running" ? "bg-emerald-500" : "bg-[#aab5c4]")} />
              {project.status === "running" ? "正在继续生成页面" : "结构板可编辑"}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button className="secondary-button hidden sm:flex" onClick={onToggleRun}>
            <Icon name={project.status === "running" ? "pause" : "play"} size={14} />
            {project.status === "running" ? "暂停" : "继续"}
          </button>
          <button className="primary-button" onClick={onEnter}>
            进入画布
            <Icon name="arrow" size={15} />
          </button>
        </div>
      </header>

      <div className="blueprint-grid custom-scroll flex-1 overflow-auto">
        <div className="min-w-max px-6 py-7 md:px-10 md:py-9">
          <div className="mb-6 flex items-end justify-between">
            <div>
              <div className="text-[11px] font-semibold tracking-[0.16em] text-[#2f80ff]">
                STORYLINE BOARD
              </div>
              <h1 className="mt-1 text-[25px] font-semibold tracking-[-0.035em]">演示结构板</h1>
              <p className="mt-1.5 text-[12px] text-[#7d8ca0]">
                {project.pages.length} 页 · {groups.length} 个叙事区段 · 点击页面进入画布
              </p>
            </div>
          </div>
          <div className="flex items-start gap-5">
            {groups.map((group, groupIndex) => (
              <section key={group.key} className="w-[610px] shrink-0">
                <div className="structure-section-card">
                  <div className="text-[10px] font-semibold tracking-[0.18em] text-[#2f80ff]">
                    {String(groupIndex + 1).padStart(2, "0")} / SECTION
                  </div>
                  <div className="mt-7 max-w-[480px] text-[26px] font-semibold leading-[1.15] tracking-[-0.04em]">
                    {group.title}
                  </div>
                  <div className="mt-3 text-[11px] text-[#8a99ab]">{group.pages.length} 页内容</div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  {group.pages.map((page) => (
                    <StructurePageCard
                      key={page.id}
                      page={page}
                      count={project.pages.length}
                      onOpen={() => onOpen(page.id)}
                      onEdit={() => setEditing(page)}
                      onMove={(direction) => onMove(page.id, direction)}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
          {error && <div className="mt-5 text-[12px] text-red-600">{error}</div>}
        </div>
      </div>
      {editing && (
        <PageEditDialog
          page={editing}
          onClose={() => setEditing(null)}
          onSave={async (input) => {
            const saved = await onEdit(editing.id, input);
            if (saved) setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function StructurePageCard({
  page,
  count,
  onOpen,
  onEdit,
  onMove,
}: {
  page: PageDTO;
  count: number;
  onOpen: () => void;
  onEdit: () => void;
  onMove: (direction: -1 | 1) => void;
}) {
  return (
    <article className="group relative min-h-[188px] rounded-[16px] border border-[#e4e9f0] bg-white p-4 shadow-[0_8px_26px_rgba(38,60,90,0.055)] transition duration-200 hover:-translate-y-0.5 hover:border-[#bcd5fb] hover:shadow-[0_14px_34px_rgba(38,80,150,0.10)]">
      <button className="block w-full text-left" onClick={onOpen}>
        <div className="flex items-center justify-between text-[10px] font-medium text-[#8d9aab]">
          <span>#{String(page.sortOrder + 1).padStart(2, "0")}</span>
          <span className="rounded-full bg-[#f2f5f8] px-2 py-1">{pageTypeLabel(page.pageType)}</span>
        </div>
        <h2 className="mt-5 line-clamp-2 min-h-[44px] text-[15px] font-semibold leading-[1.45] tracking-[-0.02em]">
          {page.title}
        </h2>
        <p className="mt-2 line-clamp-2 min-h-[34px] text-[11px] leading-[1.55] text-[#8896a8]">
          {page.bullets.slice(0, 2).join(" · ") || "专用页面"}
        </p>
      </button>
      <div className="mt-4 grid grid-cols-3 gap-1.5">
        <ArtifactPill icon="search" label="搜索" status={page.searchStatus} />
        <ArtifactPill icon="file" label="初稿" status={page.draftStatus} />
        <ArtifactPill icon="palette" label="设计" status={page.designStatus} />
      </div>
      <div className="absolute top-3 right-3 hidden items-center gap-1 rounded-full border border-[#e4e9f0] bg-white p-1 shadow-sm group-hover:flex">
        <button className="mini-icon-button" onClick={onEdit} aria-label="编辑页面">
          <Icon name="edit" size={13} />
        </button>
        <button
          className="mini-icon-button"
          disabled={page.sortOrder === 0}
          onClick={() => onMove(-1)}
          aria-label="向前移动"
        >
          <Icon name="up" size={13} />
        </button>
        <button
          className="mini-icon-button"
          disabled={page.sortOrder === count - 1}
          onClick={() => onMove(1)}
          aria-label="向后移动"
        >
          <Icon name="down" size={13} />
        </button>
      </div>
    </article>
  );
}

function ArtifactPill({
  icon,
  label,
  status,
}: {
  icon: IconName;
  label: string;
  status: string;
}) {
  const ready = status === "ready";
  const running = status === "running";
  return (
    <div
      className={cx(
        "flex items-center justify-center gap-1 rounded-[9px] border px-1.5 py-2 text-[9px] font-medium",
        ready
          ? "border-[#d9e9ff] bg-[#f2f7ff] text-[#2773df]"
          : running
            ? "border-amber-100 bg-amber-50 text-amber-700"
            : "border-[#edf0f4] bg-[#fafbfc] text-[#9aa6b5]",
      )}
    >
      <Icon name={ready ? "check" : icon} size={12} />
      {label}
    </div>
  );
}

function PageEditDialog({
  page,
  onClose,
  onSave,
}: {
  page: PageDTO;
  onClose: () => void;
  onSave: (input: { title: string; bullets: string[] }) => Promise<void>;
}) {
  const [title, setTitle] = useState(page.title);
  const [bullets, setBullets] = useState(page.bullets.join("\n"));
  const [saving, setSaving] = useState(false);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[#17243a]/25 p-4 backdrop-blur-sm">
      <div className="w-full max-w-[520px] rounded-[22px] border border-white/80 bg-white p-5 shadow-[0_28px_90px_rgba(20,40,70,0.25)]">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[11px] font-semibold text-[#2f80ff]">编辑第 {page.sortOrder + 1} 页</div>
            <div className="mt-1 text-[17px] font-semibold">调整故事线节点</div>
          </div>
          <button className="ui-icon-button" onClick={onClose} aria-label="关闭">
            <Icon name="close" size={16} />
          </button>
        </div>
        <label className="mt-5 block text-[11px] text-[#7d8ca0]">
          页面标题
          <input value={title} onChange={(event) => setTitle(event.target.value)} className="form-field mt-1.5" />
        </label>
        <label className="mt-4 block text-[11px] text-[#7d8ca0]">
          内容要点 · 每行一条
          <textarea
            value={bullets}
            onChange={(event) => setBullets(event.target.value)}
            rows={6}
            className="form-field mt-1.5 resize-none"
          />
        </label>
        <div className="mt-5 flex justify-end gap-2">
          <button className="secondary-button" onClick={onClose}>取消</button>
          <button
            className="primary-button"
            disabled={saving || !title.trim()}
            onClick={async () => {
              setSaving(true);
              await onSave({
                title: title.trim(),
                bullets: bullets.split("\n").map((item) => item.trim()).filter(Boolean),
              });
              setSaving(false);
            }}
          >
            {saving ? "保存中…" : "保存并重算"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Workbench({
  project,
  page,
  surface,
  message,
  error,
  onMessage,
  onSurface,
  onSelect,
  onStructure,
  onBack,
  onSettings,
  onPresent,
  onToggleRun,
  onSend,
  onAssumptions,
  onNotes,
}: {
  project: ProjectDTO;
  page: PageDTO | null;
  surface: Surface;
  message: string;
  error: string;
  onMessage: (value: string) => void;
  onSurface: (surface: Surface) => void;
  onSelect: (id: string) => void;
  onStructure: () => void;
  onBack: () => void;
  onSettings: () => void;
  onPresent: () => void;
  onToggleRun: () => void;
  onSend: () => void;
  onAssumptions: (input: Partial<AssumptionsDTO>) => void;
  onNotes: (notes: string) => void;
}) {
  const [railOpen, setRailOpen] = useState(false);
  const exportReady =
    project.pages.length > 0 &&
    project.pages.every((item) => item.designStatus === "ready" && item.designSvg);

  return (
    <div className="flex h-dvh overflow-hidden bg-[#e9ebf0] text-[#17243a]">
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="grid h-[62px] shrink-0 grid-cols-[190px_minmax(0,1fr)_auto] items-center border-b border-[#e5e8ee] bg-white px-2 md:grid-cols-[210px_minmax(0,1fr)_auto] md:px-3">
          <div className="surface-tabs">
            {SURFACES.map((item) => (
              <button
                key={item.id}
                onClick={() => onSurface(item.id)}
                className={cx("surface-tab", surface === item.id && "surface-tab-active")}
              >
                <Icon name={item.icon} size={13} />
                {item.label}
              </button>
            ))}
          </div>
          <div className="flex min-w-0 items-center gap-2 px-3">
            <button className="hidden text-[12px] text-[#8290a3] hover:text-[#2f80ff] md:block" onClick={onBack}>
              首页
            </button>
            <span className="hidden h-3 w-px bg-[#dfe4eb] md:block" />
            <div className="truncate text-[13px] font-semibold">{page?.title || project.title}</div>
            <span className="hidden rounded-full bg-[#f2f4f7] px-2 py-1 text-[9px] font-semibold text-[#9aa5b3] sm:inline">
              预览
            </span>
          </div>
          <div className="flex items-center justify-end gap-1.5">
            <button className="top-action rail-toggle" onClick={() => setRailOpen(true)}>
              <Icon name="sparkle" size={14} />
              <span className="hidden sm:inline">进度</span>
            </button>
            <button className="top-action desktop-run-toggle" onClick={onToggleRun}>
              <Icon name={project.status === "running" ? "pause" : "play"} size={14} />
              {project.status === "running" ? "暂停" : "继续"}
            </button>
            <button className="top-action" onClick={onPresent}>
              <Icon name="play" size={14} />
              <span className="hidden sm:inline">放映</span>
            </button>
            {exportReady ? (
              <a href={"/api/projects/" + project.id + "/export"} className="primary-button">
                <Icon name="download" size={14} />
                <span className="hidden sm:inline">导出</span>
              </a>
            ) : (
              <button className="primary-button" disabled title="全部设计稿完成后才能导出">
                <Icon name="download" size={14} />
                <span className="hidden sm:inline">导出</span>
              </button>
            )}
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
          <aside className="flex w-[190px] shrink-0 flex-col border-r border-[#e3e6eb] bg-white md:w-[210px]">
            <div className="flex items-center justify-between px-3 py-3 text-[11px] font-medium text-[#748399]">
              <span>幻灯片</span>
              <span>共 {project.pages.length} 页</span>
            </div>
            <div className="custom-scroll flex-1 space-y-2 overflow-y-auto px-2 pb-3">
              {project.pages.map((item) => (
                <button
                  key={item.id}
                  onClick={() => onSelect(item.id)}
                  className={cx(
                    "thumb-card",
                    item.id === page?.id && "thumb-card-active",
                  )}
                >
                  <span className="thumb-number">{item.sortOrder + 1}</span>
                  <Thumb svg={surface === "draft" ? item.draftSvg : item.designSvg} />
                  <span className="block truncate px-2 py-1.5 text-left text-[9px] text-[#69788d]">
                    {item.title}
                  </span>
                </button>
              ))}
            </div>
            <button
              onClick={onStructure}
              className="m-2 flex items-center justify-center gap-2 rounded-[10px] border border-[#e4e8ee] px-3 py-2.5 text-[11px] font-medium text-[#68778b] hover:border-[#bcd5fb] hover:text-[#2f80ff]"
            >
              <Icon name="board" size={14} />
              返回结构板
            </button>
          </aside>

          <main className="flex min-w-0 flex-1 flex-col">
            <div className="canvas-grid flex min-h-0 flex-1 items-center justify-center overflow-auto px-4 py-5 md:px-7 md:py-7">
              <CanvasSurface page={page} surface={surface} />
            </div>
            <div className="shrink-0 border-t border-[#e0e4ea] bg-white">
              <div className="flex items-center gap-2 px-4 pt-3 text-[11px] font-medium text-[#75849a]">
                <Icon name="mic" size={14} />
                演讲备注
              </div>
              <textarea
                key={page?.id}
                defaultValue={page?.speakerNotes ?? ""}
                className="h-[62px] w-full resize-none bg-transparent px-4 py-2 text-[12px] leading-5 text-[#526176] outline-none"
                placeholder="点击此处添加演讲备注…"
                onBlur={(event) => onNotes(event.target.value)}
              />
            </div>
          </main>
        </div>
      </div>

      <ProcessRail
        className="hidden w-[390px] shrink-0 xl:flex"
        project={project}
        page={page}
        surface={surface}
        message={message}
        error={error}
        onMessage={onMessage}
        onSurface={onSurface}
        onSend={onSend}
        onSettings={onSettings}
        onAssumptions={onAssumptions}
      />

      {railOpen && (
        <div className="fixed inset-0 z-50 bg-[#17243a]/25 backdrop-blur-sm xl:hidden" onClick={() => setRailOpen(false)}>
          <ProcessRail
            className="ml-auto h-full w-[min(420px,94vw)]"
            project={project}
            page={page}
            surface={surface}
            message={message}
            error={error}
            onMessage={onMessage}
            onSurface={(value) => {
              onSurface(value);
              setRailOpen(false);
            }}
            onSend={onSend}
            onSettings={onSettings}
            onAssumptions={onAssumptions}
            onClose={() => setRailOpen(false)}
          />
        </div>
      )}
    </div>
  );
}

function CanvasSurface({ page, surface }: { page: PageDTO | null; surface: Surface }) {
  if (!page) return <EmptyCanvas label="还没有可预览的页面" />;
  if (surface === "search") return <SearchCanvas page={page} />;
  const svg = surface === "draft" ? page.draftSvg : page.designSvg;
  const status = surface === "draft" ? page.draftStatus : page.designStatus;
  if (!svg) {
    return (
      <EmptyCanvas
        label={
          status === "running"
            ? surface === "draft"
              ? "正在编排这一页的初稿…"
              : "正在完成这一页的视觉设计…"
            : surface === "draft"
              ? "这页初稿还未生成"
              : "这页设计稿还未生成"
        }
      />
    );
  }
  return (
    <div className="aspect-video w-full max-w-[1180px] overflow-hidden bg-white shadow-[0_20px_65px_rgba(38,50,70,0.16)]">
      <img
        alt={page.title + (surface === "draft" ? "初稿" : "设计稿")}
        src={"data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg)}
        className="h-full w-full object-contain"
      />
    </div>
  );
}

function SearchCanvas({ page }: { page: PageDTO }) {
  return (
    <div className="aspect-video w-full max-w-[1180px] overflow-hidden bg-white p-[4%] shadow-[0_20px_65px_rgba(38,50,70,0.16)]">
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex items-center gap-3">
          <span className="h-7 w-1 rounded-full bg-[#2f80ff]" />
          <div>
            <div className="text-[clamp(16px,1.8vw,28px)] font-semibold tracking-[-0.03em]">{page.title}</div>
            <div className="mt-1 text-[clamp(8px,0.8vw,12px)] text-[#8795a8]">页面资料袋 · 仅用于当前页面</div>
          </div>
        </div>
        <div className="mt-[3%] grid min-h-0 flex-1 grid-cols-[1.1fr_0.9fr] gap-[2%]">
          <div className="custom-scroll overflow-auto rounded-[14px] border border-[#e4e9f0] bg-[#fbfcfe] p-[4%]">
            <div className="text-[clamp(10px,1vw,14px)] font-semibold">研究摘要</div>
            <p className="mt-3 whitespace-pre-wrap text-[clamp(8px,0.9vw,13px)] leading-[1.7] text-[#5f6f84]">
              {page.summaryMd || "摘要正在生成…"}
            </p>
          </div>
          <div className="custom-scroll overflow-auto rounded-[14px] border border-[#e4e9f0] p-[4%]">
            <div className="flex items-center justify-between">
              <div className="text-[clamp(10px,1vw,14px)] font-semibold">参考来源</div>
              <span className="rounded-full bg-[#eef5ff] px-2 py-1 text-[clamp(7px,0.7vw,10px)] text-[#2f80ff]">
                {page.sources.length} 条
              </span>
            </div>
            <div className="mt-3 space-y-2">
              {page.sources.map((source, index) => (
                <a
                  key={source.url + source.title}
                  href={source.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block rounded-[10px] border border-[#ebeff4] px-3 py-2 hover:border-[#bcd5fb] hover:bg-[#f7faff]"
                >
                  <div className="flex gap-2 text-[clamp(8px,0.8vw,12px)] font-medium">
                    <span className="text-[#2f80ff]">{String(index + 1).padStart(2, "0")}</span>
                    <span className="line-clamp-1">{source.title}</span>
                  </div>
                </a>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function EmptyCanvas({ label }: { label: string }) {
  return (
    <div className="grid aspect-video w-full max-w-[1180px] place-items-center border border-dashed border-[#cfd5de] bg-white/72 shadow-[0_20px_65px_rgba(38,50,70,0.08)]">
      <div className="text-center">
        <span className="mx-auto grid h-11 w-11 place-items-center rounded-[14px] bg-[#edf4ff] text-[#2f80ff]">
          <Icon name="sparkle" size={20} />
        </span>
        <div className="mt-3 text-[12px] font-medium text-[#77869b]">{label}</div>
      </div>
    </div>
  );
}

function ProcessRail({
  className,
  project,
  page,
  surface,
  message,
  error,
  onMessage,
  onSurface,
  onSend,
  onSettings,
  onAssumptions,
  onClose,
}: {
  className?: string;
  project: ProjectDTO;
  page: PageDTO | null;
  surface: Surface;
  message: string;
  error: string;
  onMessage: (value: string) => void;
  onSurface: (surface: Surface) => void;
  onSend: () => void;
  onSettings: () => void;
  onAssumptions: (input: Partial<AssumptionsDTO>) => void;
  onClose?: () => void;
}) {
  const searchReady = project.pages.filter((item) => item.searchStatus === "ready").length;
  const draftReady = project.pages.filter((item) => item.draftStatus === "ready").length;
  const designReady = project.pages.filter((item) => item.designStatus === "ready").length;
  const searchActivity = project.stage === "research" && project.status === "running"
    ? [...project.events]
        .reverse()
        .find((event) => event.kind === "search-progress" || event.kind === "search")
    : undefined;
  return (
    <aside
      className={cx(
        "flex flex-col overflow-hidden border-l border-[#e3e6eb] bg-white",
        className,
      )}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="flex h-[62px] shrink-0 items-center justify-between border-b border-[#edf0f4] px-4">
        <div className="min-w-0">
          <div className="truncate text-[14px] font-semibold">{project.title}</div>
          <div className="mt-0.5 text-[10px] text-[#95a1b0]">Agent 制作进度</div>
        </div>
        <div className="flex items-center gap-1">
          <button className="ui-icon-button" onClick={onSettings} aria-label="打开设置">
            <Icon name="settings" size={16} />
          </button>
          {onClose && (
            <button className="ui-icon-button" onClick={onClose} aria-label="关闭面板">
              <Icon name="close" size={16} />
            </button>
          )}
        </div>
      </div>

      <div className="custom-scroll flex-1 space-y-3 overflow-y-auto bg-[#fbfcfe] p-3">
        <RailStageCard
          tone="blue"
          icon="search"
          title={searchReady === project.pages.length ? "页面资料已就绪" : "正在逐页检索资料"}
          meta={searchReady + " / " + project.pages.length + " 页"}
          progress={ratio(searchReady, project.pages.length)}
        >
          <div className="space-y-1.5">
            {searchActivity && (
              <div className="flex items-start gap-2 rounded-[9px] border border-[#dceaff] bg-[#f2f7ff] px-2.5 py-2 text-[10px] text-[#3975c6]">
                <span className="research-pulse mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <div className="font-semibold">{searchActivity.title}</div>
                  {searchActivity.detail && (
                    <div className="mt-0.5 truncate text-[#7c91ad]">{searchActivity.detail}</div>
                  )}
                </div>
              </div>
            )}
            {project.researchSources.slice(0, 3).map((source) => (
              <a
                key={source.url}
                href={source.url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 rounded-[9px] bg-white px-2.5 py-2 text-[10px] text-[#718198] hover:text-[#2f80ff]"
              >
                <Icon name="check" size={12} />
                <span className="truncate">{source.title}</span>
              </a>
            ))}
          </div>
        </RailStageCard>

        <AssumptionsRailCard project={project} onSave={onAssumptions} />

        <RailStageCard
          tone="neutral"
          icon="board"
          title="演示结构板已就绪"
          meta={project.pages.length + " 页 · 可随时调整顺序"}
          progress={1}
        />

        <button className="block w-full text-left" onClick={() => onSurface("draft")}>
          <RailStageCard
            tone={surface === "draft" ? "purple" : "neutral"}
            icon="file"
            title={draftReady === project.pages.length ? "PPT 初稿已就绪" : "正在编排 PPT 初稿"}
            meta={draftReady + " / " + project.pages.length + " 页"}
            progress={ratio(draftReady, project.pages.length)}
          />
        </button>

        <button className="block w-full text-left" onClick={() => onSurface("design")}>
          <RailStageCard
            tone={surface === "design" ? "green" : "neutral"}
            icon="palette"
            title={designReady === project.pages.length ? "设计稿已就绪" : "正在完成视觉设计"}
            meta={designReady + " / " + project.pages.length + " 页 · " + project.style.name}
            progress={ratio(designReady, project.pages.length)}
          />
        </button>

        {page && (
          <div className="flex items-center gap-2 rounded-[13px] border border-[#dbe8fb] bg-[#f1f7ff] px-3 py-2.5 text-[11px] text-[#266dcc]">
            <span className="grid h-6 w-6 place-items-center rounded-full bg-white">
              <Icon name="cursor" size={13} />
            </span>
            <span className="truncate font-medium">第 {page.sortOrder + 1} 页 · {page.title}</span>
            <span className="ml-auto rounded-full bg-white px-2 py-1 text-[9px]">{surfaceLabel(surface)}</span>
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-[#edf0f4] bg-white p-3">
        <div className="rounded-[16px] border border-[#dfe5ed] bg-[#fbfcfe] p-2.5 shadow-[0_5px_18px_rgba(40,60,90,0.04)] focus-within:border-[#9bc1fb]">
          <textarea
            value={message}
            onChange={(event) => onMessage(event.target.value)}
            placeholder={page ? "告诉 Agent 如何修改当前页…" : "先选择一页"}
            disabled={!page}
            className="h-[74px] w-full resize-none bg-transparent px-1 text-[12px] leading-5 text-[#3e4d62] outline-none placeholder:text-[#a5afbc]"
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                onSend();
              }
            }}
          />
          <div className="flex items-center justify-between">
            <span className="text-[9px] text-[#9ba7b6]">Enter 发送 · Shift + Enter 换行</span>
            <button
              disabled={!page || !message.trim()}
              onClick={onSend}
              className="grid h-8 w-8 place-items-center rounded-full bg-[#2f80ff] text-white disabled:bg-[#dbe2eb]"
              aria-label="发送改稿要求"
            >
              <Icon name="send" size={14} />
            </button>
          </div>
        </div>
        {(error || project.errorText) && (
          <div className="mt-2 text-[10px] text-red-600">{error || project.errorText}</div>
        )}
      </div>
    </aside>
  );
}

function AssumptionsRailCard({
  project,
  onSave,
}: {
  project: ProjectDTO;
  onSave: (input: Partial<AssumptionsDTO>) => void;
}) {
  const [draft, setDraft] = useState(project.assumptions);
  const snapshot = JSON.stringify(project.assumptions);
  useEffect(() => setDraft(project.assumptions), [snapshot]);
  const changed = JSON.stringify(draft) !== snapshot;
  return (
    <details className="overflow-hidden rounded-[15px] border border-[#cfeadd] bg-[#f2fbf7]">
      <summary className="cursor-pointer list-none px-3.5 py-3">
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-full bg-[#14a36d] text-white">
            <Icon name="check" size={14} />
          </span>
          <div className="min-w-0">
            <div className="text-[12px] font-semibold text-[#167a58]">设计需求已确认</div>
            <div className="mt-0.5 truncate text-[10px] text-[#668c7e]">
              {project.style.name} · {project.assumptions.pageCount} 页
            </div>
          </div>
          <Icon name="down" size={13} className="ml-auto text-[#5c9a81]" />
        </div>
      </summary>
      <div className="space-y-2.5 border-t border-[#d7eee4] bg-white/65 p-3">
        <label className="block text-[9px] font-medium text-[#708276]">
          视觉风格
          <select
            value={draft.styleId}
            onChange={(event) => {
              const styleId = event.target.value;
              setDraft((current) => ({ ...current, styleId }));
              onSave({ styleId });
            }}
            className="form-field mt-1"
          >
            {project.styles.map((style) => (
              <option key={style.id} value={style.id}>{style.name}</option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-[78px_1fr] gap-2">
          <label className="block text-[9px] font-medium text-[#708276]">
            页数
            <input
              type="number"
              min={8}
              max={16}
              value={draft.pageCount}
              onChange={(event) => setDraft((current) => ({ ...current, pageCount: Number(event.target.value) }))}
              className="form-field mt-1"
            />
          </label>
          <label className="block text-[9px] font-medium text-[#708276]">
            受众
            <input
              value={draft.audience}
              onChange={(event) => setDraft((current) => ({ ...current, audience: event.target.value }))}
              className="form-field mt-1"
            />
          </label>
        </div>
        <label className="block text-[9px] font-medium text-[#708276]">
          演示目标
          <textarea
            value={draft.purpose}
            onChange={(event) => setDraft((current) => ({ ...current, purpose: event.target.value }))}
            rows={2}
            className="form-field mt-1 resize-none"
          />
        </label>
        <button
          disabled={!changed}
          className="secondary-button ml-auto"
          onClick={() => onSave(draft)}
        >
          保存并重算
        </button>
      </div>
    </details>
  );
}

function RailStageCard({
  tone,
  icon,
  title,
  meta,
  progress,
  children,
}: {
  tone: "blue" | "green" | "purple" | "neutral";
  icon: IconName;
  title: string;
  meta: string;
  progress: number;
  children?: ReactNode;
}) {
  const toneClass = {
    blue: "border-[#d8e8ff] bg-[#f2f7ff]",
    green: "border-[#d3ecdf] bg-[#f1faf5]",
    purple: "border-[#e4ddfb] bg-[#f7f4ff]",
    neutral: "border-[#e5e9ef] bg-white",
  }[tone];
  const barClass = {
    blue: "bg-[#2f80ff]",
    green: "bg-[#17a673]",
    purple: "bg-[#7b61df]",
    neutral: "bg-[#8fa1b8]",
  }[tone];
  return (
    <div className={cx("rounded-[15px] border p-3.5", toneClass)}>
      <div className="flex items-center gap-2.5">
        <span className="grid h-7 w-7 place-items-center rounded-[9px] bg-white text-[#3577d6] shadow-sm">
          <Icon name={icon} size={14} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] font-semibold">{title}</div>
          <div className="mt-0.5 truncate text-[10px] text-[#7d8b9d]">{meta}</div>
        </div>
        <span className="text-[10px] font-semibold text-[#78879a]">{Math.round(progress * 100)}%</span>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/90">
        <div className={cx("h-full rounded-full transition-all", barClass)} style={{ width: Math.max(4, progress * 100) + "%" }} />
      </div>
      {children && <div className="mt-3">{children}</div>}
    </div>
  );
}

function Thumb({ svg }: { svg: string }) {
  if (!svg) {
    return (
      <div className="grid aspect-video w-full place-items-center bg-[#f5f7fa] text-[#c1c9d4]">
        <Icon name="sparkle" size={16} />
      </div>
    );
  }
  return (
    <img
      alt=""
      className="aspect-video w-full bg-white object-contain"
      src={"data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg)}
    />
  );
}

function LoadingScreen({ label }: { label: string }) {
  return (
    <div className="requirements-shell grid h-dvh place-items-center text-[#72839a]">
      <div className="text-center">
        <span className="research-pulse mx-auto block" />
        <div className="mt-4 text-[13px]">{label}</div>
      </div>
    </div>
  );
}

function groupPages(pages: PageDTO[]) {
  const groups: Array<{ key: string; sourceKey: string; title: string; pages: PageDTO[] }> = [];
  for (const page of pages) {
    const sourceKey =
      page.pageType === "cover" || page.pageType === "toc"
        ? "opening"
        : page.pageType === "end"
          ? "ending"
          : page.sectionTitle || "main";
    const title =
      sourceKey === "opening"
        ? "开场与目录"
        : sourceKey === "ending"
          ? "总结与收束"
          : page.sectionTitle || "核心内容";
    const current = groups.at(-1);
    if (current?.sourceKey === sourceKey) current.pages.push(page);
    else groups.push({ key: sourceKey + "-" + groups.length, sourceKey, title, pages: [page] });
  }
  return groups;
}

function pageTypeLabel(type: PageDTO["pageType"]) {
  return { cover: "封面", toc: "目录", content: "内容页", end: "结尾" }[type];
}

function surfaceLabel(surface: Surface) {
  return { search: "搜索", draft: "初稿", design: "设计稿" }[surface];
}

function ratio(value: number, total: number) {
  return total ? Math.min(1, value / total) : 0;
}

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

type IconName =
  | "arrow"
  | "back"
  | "board"
  | "check"
  | "close"
  | "cursor"
  | "down"
  | "download"
  | "edit"
  | "file"
  | "mic"
  | "palette"
  | "pause"
  | "play"
  | "search"
  | "send"
  | "settings"
  | "sparkle"
  | "target"
  | "up";

function Icon({
  name,
  size = 16,
  className,
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className,
    "aria-hidden": true,
  };
  switch (name) {
    case "back":
      return <svg {...common}><path d="m15 18-6-6 6-6" /></svg>;
    case "arrow":
      return <svg {...common}><path d="M5 12h14M13 6l6 6-6 6" /></svg>;
    case "check":
      return <svg {...common}><path d="m5 12 4 4L19 6" /></svg>;
    case "search":
      return <svg {...common}><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></svg>;
    case "file":
      return <svg {...common}><path d="M7 3h7l4 4v14H7z" /><path d="M14 3v5h5M10 13h5M10 17h5" /></svg>;
    case "palette":
      return <svg {...common}><path d="M12 3a9 9 0 1 0 0 18h1.2a2 2 0 0 0 0-4H12a2 2 0 0 1 0-4h3a6 6 0 0 0-3-10Z" /><circle cx="7.5" cy="10" r=".7" fill="currentColor" /><circle cx="9.5" cy="6.5" r=".7" fill="currentColor" /><circle cx="14" cy="6.5" r=".7" fill="currentColor" /></svg>;
    case "board":
      return <svg {...common}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M8 4v16M8 10h13" /></svg>;
    case "play":
      return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="m10 8 6 4-6 4Z" /></svg>;
    case "pause":
      return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M10 9v6M14 9v6" /></svg>;
    case "download":
      return <svg {...common}><path d="M12 3v12M7 10l5 5 5-5M4 20h16" /></svg>;
    case "settings":
      return <svg {...common}><circle cx="12" cy="12" r="3" /><path d="M19 13.5v-3l-2-.6-.7-1.7 1-1.8-2.1-2.1-1.8 1-1.7-.7L10.5 3h-3l-.6 2-1.7.7-1.8-1-2.1 2.1 1 1.8-.7 1.7-2 .6v3l2 .6.7 1.7-1 1.8 2.1 2.1 1.8-1 1.7.7.6 2h3l.6-2 1.7-.7 1.8 1 2.1-2.1-1-1.8.7-1.7z" transform="scale(.75) translate(4 4)" /></svg>;
    case "sparkle":
      return <svg {...common}><path d="m12 3 1.4 4.1L17.5 8.5l-4.1 1.4L12 14l-1.4-4.1-4.1-1.4 4.1-1.4ZM18 14l.8 2.2L21 17l-2.2.8L18 20l-.8-2.2L15 17l2.2-.8Z" /></svg>;
    case "target":
      return <svg {...common}><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /><path d="M19 5 13.5 10.5" /></svg>;
    case "edit":
      return <svg {...common}><path d="m4 16-.8 4 4-.8L18 8.4 14.6 5Z" /><path d="m13.5 6 3.4 3.4" /></svg>;
    case "up":
      return <svg {...common}><path d="m7 14 5-5 5 5" /></svg>;
    case "down":
      return <svg {...common}><path d="m7 10 5 5 5-5" /></svg>;
    case "close":
      return <svg {...common}><path d="m6 6 12 12M18 6 6 18" /></svg>;
    case "mic":
      return <svg {...common}><rect x="9" y="3" width="6" height="12" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>;
    case "cursor":
      return <svg {...common}><path d="m5 3 12 8-5 1 3 6-2.5 1.3-3-6-4 3Z" /></svg>;
    case "send":
      return <svg {...common}><path d="m3 11 17-8-7 18-2-7Z" /><path d="m11 14 9-11" /></svg>;
    default:
      return <svg {...common}><circle cx="12" cy="12" r="8" /></svg>;
  }
}
