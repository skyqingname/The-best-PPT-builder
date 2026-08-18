"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { EventDTO, PageDTO, ProjectDTO } from "@/lib/client-types";

type Surface = "search" | "draft" | "design";
type View = "stickies" | "board";

const NOTE_COLORS = ["#FFE8A3", "#FFD0D0", "#D8F0C8", "#D6E8FF", "#F3D9FF", "#FFE4C4"];

export default function ProjectScreen({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [project, setProject] = useState<ProjectDTO | null>(null);
  const [view, setView] = useState<View>("stickies");
  const [surface, setSurface] = useState<Surface>("design");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function refresh() {
    const response = await fetch(`/api/projects/${projectId}`);
    if (!response.ok) return;
    const data = (await response.json()) as ProjectDTO;
    setProject(data);
    setActiveId((current) => current ?? data.pages[0]?.id ?? null);
    if (data.outlineReady && data.pages.some((page) => page.designSvg || page.draftSvg)) {
      // keep current view
    }
  }

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 1600);
    return () => clearInterval(timer);
  }, [projectId]);

  useEffect(() => {
    const source = new EventSource(`/api/projects/${projectId}/events`);
    source.onmessage = () => {
      void refresh();
    };
    return () => source.close();
  }, [projectId]);

  const page = useMemo(
    () => project?.pages.find((item) => item.id === activeId) ?? project?.pages[0] ?? null,
    [project, activeId],
  );

  if (!project) {
    return <div className="grid h-dvh place-items-center text-[#6e6e73]">加载项目…</div>;
  }

  const showStickies = view === "stickies" || !project.outlineReady;

  async function postAction(payload: Record<string, unknown>) {
    setError("");
    const response = await fetch(`/api/projects/${projectId}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) {
      setError(data.error || "操作失败");
      return;
    }
    setProject(data);
  }

  async function sendChat() {
    if (!page || !message.trim()) return;
    const current = message;
    setMessage("");
    await postAction({
      type: "chat",
      pageId: page.id,
      message: current,
      surface,
    });
  }

  return (
    <div className="flex h-dvh overflow-hidden bg-[#f3f4f6] text-[#1d1d1f]">
      {showStickies ? (
        <StickyBoard
          project={project}
          onOpen={(id) => {
            setActiveId(id);
            setView("board");
            setSurface("design");
          }}
          onBack={() => router.push("/")}
          onAssumptions={(assumptions) =>
            void postAction({ type: "updateAssumptions", assumptions })
          }
        />
      ) : (
        <Workbench
          project={project}
          page={page}
          surface={surface}
          onSurface={setSurface}
          onSelect={setActiveId}
          onStickies={() => setView("stickies")}
          onBack={() => router.push("/")}
          onPresent={() => router.push(`/projects/${projectId}/present`)}
          onNotes={(speakerNotes) => {
            if (!page) return;
            void fetch(`/api/projects/${projectId}/pages/${page.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ speakerNotes }),
            });
          }}
        />
      )}

      <aside className="m-3 hidden w-[340px] shrink-0 flex-col overflow-hidden rounded-[20px] border border-[#e5e5e5] bg-white md:flex">
        <div className="flex items-center justify-between border-b border-[#f0f0f0] px-4 py-3">
          <div className="truncate text-[14px] font-semibold">{project.title}</div>
          <button className="text-[12px] text-black/35" onClick={() => router.push("/settings")}>
            设置
          </button>
        </div>
        <AssumptionCard
          project={project}
          onSave={(assumptions) => void postAction({ type: "updateAssumptions", assumptions })}
        />
        <div className="custom-scroll flex-1 space-y-2 overflow-y-auto px-3 py-3">
          {project.events.map((event) => (
            <EventCard key={event.id} event={event} />
          ))}
        </div>
        <div className="border-t border-[#f0f0f0] p-3">
          {page && (
            <div className="mb-2 text-[12px] text-[#6e6e73]">
              第 {page.sortOrder + 1} 页 · {page.title}
            </div>
          )}
          <div className="rounded-[14px] border border-[#e5e5e5] bg-[#fafafa] p-2">
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="请输入你的编辑需求…"
              className="min-h-[72px] w-full resize-none bg-transparent text-[13px] outline-none"
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void sendChat();
                }
              }}
            />
            <div className="flex justify-end">
              <button
                onClick={() => void sendChat()}
                className="rounded-full bg-[#0b84ff] px-3 py-1 text-[12px] text-white"
              >
                发送
              </button>
            </div>
          </div>
          {error && <p className="mt-2 text-[12px] text-[#c41e3a]">{error}</p>}
        </div>
      </aside>
    </div>
  );
}

function StickyBoard({
  project,
  onOpen,
  onBack,
  onAssumptions,
}: {
  project: ProjectDTO;
  onOpen: (id: string) => void;
  onBack: () => void;
  onAssumptions: (input: Partial<ProjectDTO["assumptions"]>) => void;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="flex items-center justify-between px-5 py-3">
        <button className="text-[13px] text-black/40" onClick={onBack}>
          ← 首页
        </button>
        <div className="text-center">
          <div className="text-[15px] font-semibold">{project.title || "生成大纲中"}</div>
          <div className="text-[12px] text-[#6e6e73]">
            {project.status === "running" ? "后台继续跑，便利贴可以先改" : project.status}
          </div>
        </div>
        <button
          className="rounded-full border border-[#e5e5e5] bg-white px-3 py-1 text-[12px]"
          onClick={() => project.pages[0] && onOpen(project.pages[0].id)}
          disabled={!project.pages.length}
        >
          进入画布
        </button>
      </header>
      <div className="custom-scroll flex-1 overflow-auto px-6 pb-8">
        {!project.pages.length && (
          <div className="grid h-full place-items-center text-[#6e6e73]">
            正在调研和写便利贴…
          </div>
        )}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
          {project.pages.map((page, index) => (
            <button
              key={page.id}
              onClick={() => onOpen(page.id)}
              className="min-h-[180px] rounded-[4px] p-4 text-left shadow-[2px_3px_0_rgba(0,0,0,0.06)]"
              style={{
                background: NOTE_COLORS[index % NOTE_COLORS.length],
                transform: `rotate(${index % 2 === 0 ? -1.2 : 1.1}deg)`,
              }}
            >
              <div className="text-[11px] opacity-60">
                {page.pageType} · {page.sectionTitle || page.pageCode}
              </div>
              <div className="mt-2 text-[16px] font-semibold leading-snug">{page.title}</div>
              <ul className="mt-2 space-y-1 text-[12px] leading-snug opacity-80">
                {page.bullets.slice(0, 3).map((bullet) => (
                  <li key={bullet}>· {bullet}</li>
                ))}
              </ul>
            </button>
          ))}
        </div>
        <div className="mt-6 text-[12px] text-[#6e6e73]">
          风格 {project.style.name}。改页数或受众会重算大纲；只改风格只重跑设计稿。
        </div>
        <button
          className="mt-2 text-[12px] text-[#0b84ff]"
          onClick={() => onAssumptions({ styleId: project.assumptions.styleId })}
        >
          按当前假设继续
        </button>
      </div>
    </div>
  );
}

function Workbench({
  project,
  page,
  surface,
  onSurface,
  onSelect,
  onStickies,
  onBack,
  onPresent,
  onNotes,
}: {
  project: ProjectDTO;
  page: PageDTO | null;
  surface: Surface;
  onSurface: (surface: Surface) => void;
  onSelect: (id: string) => void;
  onStickies: () => void;
  onBack: () => void;
  onPresent: () => void;
  onNotes: (notes: string) => void;
}) {
  const svg =
    surface === "search"
      ? ""
      : surface === "draft"
        ? page?.draftSvg
        : page?.designSvg || page?.draftSvg;

  return (
    <div className="flex min-w-0 flex-1 overflow-hidden">
      <div className="flex w-[168px] shrink-0 flex-col border-r border-[#ececec] bg-white">
        <div className="flex gap-1 px-2 pt-3">
          {(["search", "draft", "design"] as Surface[]).map((item) => (
            <button
              key={item}
              onClick={() => onSurface(item)}
              className={`rounded-full px-2 py-1 text-[11px] ${
                surface === item ? "bg-[#1d1d1f] text-white" : "text-black/45"
              }`}
            >
              {item === "search" ? "搜索" : item === "draft" ? "初稿" : "设计稿"}
            </button>
          ))}
        </div>
        <div className="custom-scroll mt-2 flex-1 space-y-2 overflow-y-auto px-2 pb-3">
          <div className="px-1 text-[11px] text-[#86868b]">幻灯片 · 共 {project.pages.length} 页</div>
          {project.pages.map((item) => (
            <button
              key={item.id}
              onClick={() => onSelect(item.id)}
              className={`block w-full overflow-hidden rounded-[10px] border ${
                item.id === page?.id ? "border-[#0b84ff]" : "border-transparent"
              } bg-[#f6f6f7]`}
            >
              <Thumb svg={item.designSvg || item.draftSvg} />
              <div className="truncate px-1 py-1 text-left text-[10px] text-[#6e6e73]">
                {item.sortOrder + 1}. {item.title}
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between px-4 py-2">
          <div className="flex items-center gap-2">
            <button className="text-[12px] text-black/35" onClick={onBack}>
              首页
            </button>
            <button className="text-[12px] text-black/35" onClick={onStickies}>
              便利贴
            </button>
            <div className="text-[14px] font-medium">{page?.title}</div>
            <span className="rounded-full bg-black/5 px-2 py-0.5 text-[11px] text-black/45">
              预览
            </span>
          </div>
          <div className="flex gap-2">
            <button
              onClick={onPresent}
              className="rounded-full border border-[#e5e5e5] bg-white px-3 py-1.5 text-[12px]"
            >
              放映
            </button>
            <a
              href={`/api/projects/${project.id}/export`}
              className="rounded-full bg-[#0b84ff] px-3 py-1.5 text-[12px] text-white"
            >
              导出
            </a>
          </div>
        </header>
        <div className="flex min-h-0 flex-1 items-center justify-center px-6">
          {surface === "search" && page ? (
            <SearchPane page={page} />
          ) : svg ? (
            <div className="aspect-video w-full max-w-[1100px] overflow-hidden rounded-[18px] bg-white shadow-[0_10px_40px_rgba(0,0,0,0.06)]">
              <img alt="" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`} className="h-full w-full object-contain" />
            </div>
          ) : (
            <div className="text-[13px] text-[#6e6e73]">这一页还在生成…</div>
          )}
        </div>
        <div className="border-t border-[#ececec] px-5 py-3">
          <div className="text-[12px] text-[#6e6e73]">演讲备注</div>
          <textarea
            defaultValue={page?.speakerNotes ?? ""}
            key={page?.id}
            className="mt-1 w-full resize-none bg-transparent text-[13px] outline-none"
            placeholder="点击此处添加演讲备注…"
            rows={2}
            onBlur={(event) => onNotes(event.target.value)}
          />
        </div>
      </div>
    </div>
  );
}

function SearchPane({ page }: { page: PageDTO }) {
  return (
    <div className="h-full w-full max-w-[820px] overflow-auto rounded-[18px] bg-white p-6">
      <h2 className="text-[20px] font-semibold">{page.title}</h2>
      <p className="mt-2 text-[13px] whitespace-pre-wrap text-[#444]">{page.summaryMd || "摘要还没写完"}</p>
      <div className="mt-4 space-y-2">
        {page.sources.map((source) => (
          <a
            key={source.url + source.title}
            href={source.url}
            target="_blank"
            rel="noreferrer"
            className="block rounded-[12px] border border-[#eee] px-3 py-2 text-[13px]"
          >
            <div className="font-medium">{source.title}</div>
            <div className="truncate text-[12px] text-[#86868b]">{source.url}</div>
          </a>
        ))}
      </div>
    </div>
  );
}

function Thumb({ svg }: { svg: string }) {
  if (!svg) {
    return <div className="aspect-video w-full bg-[#eee]" />;
  }
  return (
    <img
      alt=""
      className="aspect-video w-full object-cover"
      src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`}
    />
  );
}

function AssumptionCard({
  project,
  onSave,
}: {
  project: ProjectDTO;
  onSave: (input: Partial<ProjectDTO["assumptions"]>) => void;
}) {
  const [styleId, setStyleId] = useState(project.assumptions.styleId);
  useEffect(() => {
    setStyleId(project.assumptions.styleId);
  }, [project.assumptions.styleId]);

  return (
    <div className="border-b border-[#f0f0f0] px-4 py-3">
      <div className="text-[12px] font-medium text-emerald-700">设计风格</div>
      <div className="mt-1 text-[14px] font-semibold">
        {project.style.name}{" "}
        <span className="text-[12px] font-normal text-[#6e6e73]">{project.style.nameEn}</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {project.style.mood.map((mood) => (
          <span key={mood} className="rounded-full bg-black/5 px-2 py-0.5 text-[11px]">
            {mood}
          </span>
        ))}
      </div>
      <select
        className="mt-2 w-full rounded-[10px] border border-[#eee] bg-[#fafafa] px-2 py-1 text-[12px]"
        value={styleId}
        onChange={(event) => {
          setStyleId(event.target.value);
          onSave({ styleId: event.target.value });
        }}
      >
        {project.styles.map((style) => (
          <option key={style.id} value={style.id}>
            {style.name}
          </option>
        ))}
      </select>
      <div className="mt-2 text-[11px] leading-relaxed text-[#6e6e73]">
        {project.assumptions.audience} · {project.assumptions.pageCount} 页
        <br />
        {project.assumptions.purpose}
      </div>
    </div>
  );
}

function EventCard({ event }: { event: EventDTO }) {
  const tone =
    event.kind === "success"
      ? "bg-emerald-50 text-emerald-800"
      : event.kind === "error"
        ? "bg-red-50 text-red-700"
        : "bg-[#f6f7f8] text-[#333]";
  return (
    <div className={`rounded-[14px] px-3 py-2 text-[12px] ${tone}`}>
      <div className="font-medium">{event.title}</div>
      {event.detail && <div className="mt-0.5 opacity-70">{event.detail}</div>}
    </div>
  );
}
