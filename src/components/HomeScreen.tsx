"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { ProjectSummaryDTO } from "@/lib/client-types";

export default function HomeScreen() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [projects, setProjects] = useState<ProjectSummaryDTO[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(true);

  useEffect(() => {
    void fetch("/api/projects")
      .then((res) => res.json())
      .then((data) => setProjects(data.items ?? []));
    void fetch("/api/settings")
      .then((res) => res.json())
      .then((data) => {
        const settings = data.settings;
        setReady(
          Boolean(
            settings?.text?.apiKey &&
              settings?.text?.baseUrl &&
              settings?.text?.model &&
              settings?.svg?.apiKey &&
              settings?.svg?.baseUrl &&
              settings?.svg?.model &&
              settings?.search?.apiKey &&
              settings?.search?.baseUrl &&
              settings?.search?.model,
          ),
        );
      });
  }, []);

  async function start() {
    if (!text.trim()) return;
    setBusy(true);
    setError("");
    const response = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestText: text.trim() }),
    });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) {
      setError(data.error || "创建失败");
      return;
    }
    router.push(`/projects/${data.id}`);
  }

  return (
    <div className="flex h-dvh overflow-hidden bg-white text-[#1d1d1f]">
      <aside className="m-3 hidden w-[300px] shrink-0 flex-col overflow-hidden rounded-[20px] border border-[#e5e5e5] bg-[#f7f7f9] md:flex">
        <div className="flex items-center justify-between px-5 pt-5 pb-2">
          <div className="text-[15px] font-semibold tracking-wide">ppt-agent</div>
          <button
            className="rounded-lg px-2 py-1 text-[12px] text-black/40 hover:bg-black/5 hover:text-black/70"
            onClick={() => router.push("/settings")}
          >
            设置
          </button>
        </div>
        <div className="px-4 py-3">
          <button
            className="flex w-full items-center gap-3 rounded-[14px] border border-[#e5e5e5] bg-white px-3 py-2.5 text-left text-[14px] font-medium shadow-[0_1px_2px_rgba(0,0,0,0.02)]"
            onClick={() => setText("")}
          >
            <span className="text-lg leading-none">+</span>
            新建会话
          </button>
        </div>
        <div className="custom-scroll flex-1 space-y-0.5 overflow-y-auto px-2 pb-4">
          {projects.map((project) => (
            <button
              key={project.id}
              className="block w-full rounded-[12px] px-3 py-2.5 text-left hover:bg-white"
              onClick={() => router.push(`/projects/${project.id}`)}
            >
              <div className="truncate text-[13px] font-medium">{project.title}</div>
              <div className="mt-0.5 truncate text-[11px] text-[#86868b]">
                {project.stage} · {project.status}
              </div>
            </button>
          ))}
        </div>
      </aside>

      <main className="relative flex flex-1 flex-col items-center justify-center px-6">
        <button
          className="absolute top-5 right-6 text-[13px] text-black/40 hover:text-black/70 md:hidden"
          onClick={() => router.push("/settings")}
        >
          设置
        </button>
        <div className="w-full max-w-[760px]">
          <h1 className="serif text-center text-[40px] leading-tight font-medium tracking-[-0.03em] md:text-[52px]">
            有什么 PPT 需要我做？
          </h1>
          <p className="mt-3 text-center text-[14px] text-[#6e6e73]">
            丢一个主题。调研、提问、大纲、策划稿、设计稿，它自己跑完。
          </p>
          <div className="mt-8 rounded-[22px] border border-[#e5e5e5] bg-white p-3 shadow-[0_8px_30px_rgba(0,0,0,0.04)]">
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="例如：Dify 企业介绍 / 北京五日游攻略"
              className="min-h-[120px] w-full resize-none bg-transparent px-3 py-2 text-[16px] outline-none"
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                  void start();
                }
              }}
            />
            <div className="flex items-center justify-between px-2 pb-1">
              <span className="text-[12px] text-[#86868b]">{text.length} 字</span>
              <button
                disabled={busy || !text.trim()}
                onClick={() => void start()}
                className="rounded-full bg-[#0b84ff] px-5 py-2 text-[13px] font-medium text-white disabled:opacity-40"
              >
                {busy ? "创建中…" : "开始"}
              </button>
            </div>
          </div>
          {!ready && (
            <p className="mt-4 text-center text-[13px] text-[#b45309]">
              三套模型还没配置完整。先去
              <button className="mx-1 underline" onClick={() => router.push("/settings")}>
                设置
              </button>
              填完再开跑。
            </p>
          )}
          {error && <p className="mt-3 text-center text-[13px] text-[#c41e3a]">{error}</p>}
        </div>
      </main>
    </div>
  );
}
