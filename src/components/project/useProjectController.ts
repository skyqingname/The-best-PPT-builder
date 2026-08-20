"use client";

import { useCallback, useEffect, useState } from "react";
import type { PageDTO, ProjectDTO } from "@/lib/client-types";
import {
  ApiError,
  getProject,
  patchProjectPage,
  postProjectAction,
  uploadDesignReference,
} from "./api";

export function useProjectController(projectId: string) {
  const [project, setProject] = useState<ProjectDTO | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void getProject(projectId)
      .then((data) => {
        if (active) setProject(data);
      })
      .catch((reason: unknown) => {
        if (active) setError(readError(reason, "项目加载失败"));
      });

    const source = new EventSource(`/api/projects/${projectId}/events`);
    const update = (event: MessageEvent<string>) => {
      try {
        const data = JSON.parse(event.data) as ProjectDTO;
        if (active) setProject(data);
      } catch {
        if (active) setError("项目进度数据无法解析");
      }
    };
    source.addEventListener("project", update as EventListener);
    return () => {
      active = false;
      source.removeEventListener("project", update as EventListener);
      source.close();
    };
  }, [projectId]);

  const postAction = useCallback(async (payload: Record<string, unknown>) => {
    setError("");
    try {
      const data = await postProjectAction(projectId, payload);
      setProject(data);
      return data;
    } catch (reason) {
      setError(readError(reason, "操作失败"));
      return null;
    }
  }, [projectId]);

  const patchPage = useCallback(async (
    pageId: string,
    input: { title?: string; bullets?: string[]; speakerNotes?: string },
  ) => {
    setError("");
    try {
      const page = await patchProjectPage(projectId, pageId, input);
      setProject((current) => replacePage(current, page));
      return true;
    } catch (reason) {
      setError(readError(reason, "页面更新失败"));
      return false;
    }
  }, [projectId]);

  const uploadReference = useCallback(async (file: File) => {
    setError("");
    try {
      const data = await uploadDesignReference(projectId, file);
      setProject(data);
      return true;
    } catch (reason) {
      setError(readError(reason, "参考文件上传失败"));
      return false;
    }
  }, [projectId]);

  return { project, error, postAction, patchPage, uploadReference };
}

function replacePage(project: ProjectDTO | null, page: PageDTO): ProjectDTO | null {
  if (!project) return project;
  return {
    ...project,
    pages: project.pages.map((item) => item.id === page.id ? page : item),
  };
}

function readError(reason: unknown, fallback: string): string {
  if (reason instanceof ApiError || reason instanceof Error) return reason.message;
  return fallback;
}
