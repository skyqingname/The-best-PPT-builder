import type { PageDTO, ProjectDTO } from "@/lib/client-types";

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) {
    throw new ApiError(data.error || response.statusText || "请求失败", response.status);
  }
  return data;
}

export function getProject(projectId: string): Promise<ProjectDTO> {
  return requestJson(`/api/projects/${projectId}`);
}

export function postProjectAction(
  projectId: string,
  payload: Record<string, unknown>,
): Promise<ProjectDTO> {
  return requestJson(`/api/projects/${projectId}/actions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function patchProjectPage(
  projectId: string,
  pageId: string,
  payload: Record<string, unknown>,
): Promise<PageDTO> {
  return requestJson(`/api/projects/${projectId}/pages/${pageId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function uploadDesignReference(
  projectId: string,
  file: File,
): Promise<ProjectDTO> {
  const form = new FormData();
  form.set("file", file);
  return requestJson(`/api/projects/${projectId}/reference`, {
    method: "POST",
    body: form,
  });
}
