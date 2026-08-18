"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { ProjectDTO } from "@/lib/client-types";

export default function PresentScreen({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [project, setProject] = useState<ProjectDTO | null>(null);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    void fetch(`/api/projects/${projectId}`)
      .then((res) => res.json())
      .then(setProject);
  }, [projectId]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "ArrowRight" || event.key === " ") {
        setIndex((value) => Math.min((project?.pages.length ?? 1) - 1, value + 1));
      }
      if (event.key === "ArrowLeft") {
        setIndex((value) => Math.max(0, value - 1));
      }
      if (event.key === "Escape") {
        router.push(`/projects/${projectId}`);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [project?.pages.length, projectId, router]);

  const page = project?.pages[index];
  const svg = page?.designSvg || page?.draftSvg;

  return (
    <div className="flex h-dvh flex-col bg-black text-white">
      <div className="flex items-center justify-between px-4 py-2 text-[12px] text-white/50">
        <button onClick={() => router.push(`/projects/${projectId}`)}>退出放映</button>
        <div>
          {index + 1} / {project?.pages.length ?? 0}
        </div>
      </div>
      <div className="flex flex-1 items-center justify-center px-8 pb-8">
        {svg ? (
          <img
            alt=""
            className="max-h-full max-w-full"
            src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`}
          />
        ) : (
          <div className="text-white/40">这一页还没有稿</div>
        )}
      </div>
    </div>
  );
}
