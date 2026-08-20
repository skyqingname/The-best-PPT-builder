"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import type {
  AssumptionsDTO,
  PageDTO,
  ProjectDTO,
} from "@/lib/client-types";
import { useProjectController } from "./useProjectController";
import { ProjectIcon as Icon, type ProjectIconName as IconName } from "./ProjectIcon";
import { RequirementsFlow } from "./RequirementsFlow";
import { SpatialStructureBoard } from "./SpatialStructureBoard";
import { DesignReferenceGate } from "./DesignReferenceGate";

type Surface = "search" | "draft" | "design";
type WorkspaceView = "structure" | "workbench";

const SURFACES: Array<{ id: Surface; label: string; icon: IconName }> = [
  { id: "search", label: "搜索", icon: "search" },
  { id: "draft", label: "初稿", icon: "file" },
  { id: "design", label: "设计稿", icon: "palette" },
];

export default function ProjectExperience({ projectId }: { projectId: string }) {
  const router = useRouter();
  const { project, error, postAction, patchPage, uploadReference } = useProjectController(projectId);
  const [view, setView] = useState<WorkspaceView>("structure");
  const [surface, setSurface] = useState<Surface>("design");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [referenceOpen, setReferenceOpen] = useState(false);
  useEffect(() => {
    if (project?.pages.length) {
      setActiveId((current) => current ?? project.pages[0].id);
    }
  }, [project]);

  useEffect(() => {
    if (project?.stage === "style_reference" && project.designReference.status !== "confirmed") {
      setReferenceOpen(true);
      setSurface("draft");
    }
  }, [project?.stage, project?.designReference.status, project?.designReference.uploadId]);

  const page = useMemo(
    () => project?.pages.find((item) => item.id === activeId) ?? project?.pages[0] ?? null,
    [project, activeId],
  );

  async function movePageAfter(pageId: string, targetPageId: string) {
    if (!project || pageId === targetPageId) return;
    const ids = project.pages.map((item) => item.id).filter((id) => id !== pageId);
    const targetIndex = ids.indexOf(targetPageId);
    if (targetIndex < 0) return;
    ids.splice(targetIndex + 1, 0, pageId);
    await postAction({ type: "reorderPages", pageIds: ids });
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
      <>
        <SpatialStructureBoard
          project={project}
          error={error}
          onBack={() => router.push("/")}
          onOpen={(id, nextSurface) => {
            setActiveId(id);
            setView("workbench");
            setSurface(nextSurface);
          }}
          onEnter={() => {
            setActiveId((current) => current ?? project.pages[0]?.id ?? null);
            setView("workbench");
            setSurface(project.stage === "style_reference" ? "draft" : "design");
          }}
          onToggleRun={() =>
            void postAction({ type: project.status === "running" ? "cancel" : "resume" })
          }
          onReorder={(pageId, targetPageId) => void movePageAfter(pageId, targetPageId)}
          onStructureChat={(input) => void postAction({ type: "structureChat", ...input })}
          onApplyProposal={(proposalId) => void postAction({ type: "applyStructureProposal", proposalId })}
          onDismissProposal={(proposalId) => void postAction({ type: "dismissStructureProposal", proposalId })}
        />
        <ReferenceGateLayer
          project={project}
          open={referenceOpen}
          onOpen={() => setReferenceOpen(true)}
          onClose={() => setReferenceOpen(false)}
          onUpload={uploadReference}
          onConfirm={(input) => {
            setReferenceOpen(false);
            void postAction({ type: "confirmDesignReference", ...input });
          }}
        />
      </>
    );
  }

  return (
    <>
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
          void patchPage(page.id, { speakerNotes });
        }}
      />
      <ReferenceGateLayer
        project={project}
        open={referenceOpen}
        onOpen={() => setReferenceOpen(true)}
        onClose={() => setReferenceOpen(false)}
        onUpload={uploadReference}
        onConfirm={(input) => {
          setReferenceOpen(false);
          void postAction({ type: "confirmDesignReference", ...input });
        }}
      />
    </>
  );
}

function ReferenceGateLayer({
  project,
  open,
  onOpen,
  onClose,
  onUpload,
  onConfirm,
}: {
  project: ProjectDTO;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onUpload: (file: File) => Promise<boolean>;
  onConfirm: (input: { mode: "preset" | "upload"; styleId: string; colorPreference: string }) => void;
}) {
  const needed = project.stage === "style_reference" && project.designReference.status !== "confirmed";
  if (!needed) return null;
  return (
    <>
      {!open && (
        <button className="reference-gate-reopen" onClick={onOpen}>
          <Icon name="palette" size={15} />
          确认设计参考
        </button>
      )}
      <DesignReferenceGate
        project={project}
        open={open}
        onClose={onClose}
        onUpload={onUpload}
        onConfirm={onConfirm}
      />
    </>
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
    <div className="fixed inset-0 z-40 flex overflow-hidden bg-[#e9ebf0] text-[#17243a]">
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="grid h-[62px] shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center border-b border-[#e5e8ee] bg-white px-2 md:grid-cols-[210px_minmax(0,1fr)_auto] md:px-3">
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
          <div className="hidden min-w-0 items-center gap-2 px-3 md:flex">
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
          <aside className="hidden w-[190px] shrink-0 flex-col border-r border-[#e3e6eb] bg-white md:flex md:w-[210px]">
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
            <div className="custom-scroll flex shrink-0 gap-2 overflow-x-auto border-b border-[#e1e6ed] bg-white px-2 py-2 md:hidden">
              {project.pages.map((item) => (
                <button
                  key={item.id}
                  onClick={() => onSelect(item.id)}
                  className={cx(
                    "min-w-[76px] rounded-[10px] border px-2 py-2 text-left",
                    item.id === page?.id
                      ? "border-[#2f80ff] bg-[#edf5ff] text-[#246dcc]"
                      : "border-[#e2e7ed] bg-[#f8f9fb] text-[#77869a]",
                  )}
                >
                  <span className="block text-[9px] font-semibold">{String(item.sortOrder + 1).padStart(2, "0")}</span>
                  <span className="mt-1 block truncate text-[8px]">{item.title}</span>
                </button>
              ))}
            </div>
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
      <SvgImage
        alt={page.title + (surface === "draft" ? "初稿" : "设计稿")}
        svg={svg}
        className="h-full w-full object-contain"
        fallback={
          <div className="grid h-full place-items-center bg-[#f8fafc] text-center text-[13px] text-[#7a899d]">
            <div>
              <Icon name="sparkle" size={18} className="mx-auto mb-3 text-[#2f80ff]" />
              这页稿件无法渲染，继续项目后会自动修复
            </div>
          </div>
        }
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

        <RailStageCard
          tone={project.deckPlan?.status === "ready" ? "green" : "neutral"}
          icon="target"
          title={project.deckPlan?.status === "ready" ? "整套内容策划已就绪" : "正在统一内容策划"}
          meta={project.deckPlan?.shared.concept || "统一版式、字阶与配图意图"}
          progress={project.deckPlan?.status === "ready" ? 1 : project.stage === "planning" ? 0.5 : 0}
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

        <RailStageCard
          tone={project.designReference.status === "confirmed" ? "green" : "neutral"}
          icon="palette"
          title={project.designReference.status === "confirmed" ? "设计参考已确认" : "等待确认设计参考"}
          meta={project.designReference.profile?.name || project.style.name}
          progress={project.designReference.status === "confirmed" ? 1 : project.designReference.status === "ready" ? 0.8 : 0}
        />

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
    <SvgImage
      alt=""
      className="aspect-video w-full bg-white object-contain"
      svg={svg}
      fallback={
        <div className="grid aspect-video w-full place-items-center bg-[#f5f7fa] text-[#c1c9d4]">
          <Icon name="sparkle" size={16} />
        </div>
      }
    />
  );
}

function SvgImage({
  svg,
  alt,
  className,
  fallback,
}: {
  svg: string;
  alt: string;
  className: string;
  fallback: ReactNode;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [svg]);
  if (failed) return fallback;
  return (
    <img
      alt={alt}
      className={className}
      src={"data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg)}
      onError={() => setFailed(true)}
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

function surfaceLabel(surface: Surface) {
  return { search: "搜索", draft: "初稿", design: "设计稿" }[surface];
}

function ratio(value: number, total: number) {
  return total ? Math.min(1, value / total) : 0;
}

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}
