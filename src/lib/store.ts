import { getDb, newId, nowIso } from "./db";
import { parseAssumptionsJson } from "./assumptions";
import type {
  EventRow,
  PageRow,
  PageType,
  ProjectAssumptions,
  ProjectRow,
  ProjectStage,
} from "./types";

export function listProjects(): ProjectRow[] {
  return getDb()
    .prepare("SELECT * FROM projects ORDER BY updated_at DESC")
    .all() as ProjectRow[];
}

export function getProject(id: string): ProjectRow {
  const row = getDb().prepare("SELECT * FROM projects WHERE id = ?").get(id) as
    | ProjectRow
    | undefined;
  if (!row) throw new Error("项目不存在");
  return row;
}

export function createProject(requestText: string): ProjectRow {
  const id = newId("p");
  const stamp = nowIso();
  const title = requestText.trim().slice(0, 32) || "未命名项目";
  getDb()
    .prepare(
      `INSERT INTO projects (
        id, title, request_text, stage, status, page_count_target, style_id,
        assumptions_json, outline_json, init_sources_json, created_at, updated_at
      ) VALUES (?, ?, ?, 'init', 'running', 12, 'brand-clean', '{}', '', '[]', ?, ?)`,
    )
    .run(id, title, requestText.trim(), stamp, stamp);
  return getProject(id);
}

export function updateProject(
  id: string,
  patch: Partial<
    Pick<
      ProjectRow,
      | "title"
      | "stage"
      | "status"
      | "page_count_target"
      | "style_id"
      | "assumptions_json"
      | "outline_json"
      | "init_sources_json"
      | "error_text"
    >
  >,
): ProjectRow {
  const current = getProject(id);
  const next = { ...current, ...patch, updated_at: nowIso() };
  getDb()
    .prepare(
      `UPDATE projects SET
        title = ?, stage = ?, status = ?, page_count_target = ?, style_id = ?,
        assumptions_json = ?, outline_json = ?, init_sources_json = ?,
        error_text = ?, updated_at = ?
      WHERE id = ?`,
    )
    .run(
      next.title,
      next.stage,
      next.status,
      next.page_count_target,
      next.style_id,
      next.assumptions_json,
      next.outline_json,
      next.init_sources_json,
      next.error_text,
      next.updated_at,
      id,
    );
  return getProject(id);
}

export function listPages(projectId: string): PageRow[] {
  return getDb()
    .prepare("SELECT * FROM pages WHERE project_id = ? ORDER BY sort_order ASC")
    .all(projectId) as PageRow[];
}

export function getPage(pageId: string): PageRow {
  const row = getDb().prepare("SELECT * FROM pages WHERE id = ?").get(pageId) as
    | PageRow
    | undefined;
  if (!row) throw new Error("页面不存在");
  return row;
}

export function getProjectPage(projectId: string, pageId: string): PageRow {
  const row = getDb()
    .prepare("SELECT * FROM pages WHERE id = ? AND project_id = ?")
    .get(pageId, projectId) as PageRow | undefined;
  if (!row) throw new Error("页面不存在或不属于当前项目");
  return row;
}

export function insertPage(input: {
  projectId: string;
  pageCode: string;
  sortOrder: number;
  pageType: PageType;
  sectionTitle: string | null;
  title: string;
  bullets: string[];
}): PageRow {
  const id = newId("pg");
  const stamp = nowIso();
  getDb()
    .prepare(
      `INSERT INTO pages (
        id, project_id, page_code, sort_order, page_type, section_title, title,
        bullets_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.projectId,
      input.pageCode,
      input.sortOrder,
      input.pageType,
      input.sectionTitle,
      input.title,
      JSON.stringify(input.bullets),
      stamp,
      stamp,
    );
  return getPage(id);
}

export function updatePage(
  pageId: string,
  patch: Partial<
    Omit<PageRow, "id" | "project_id" | "created_at">
  >,
): PageRow {
  const current = getPage(pageId);
  const next = { ...current, ...patch, updated_at: nowIso() };
  getDb()
    .prepare(
      `UPDATE pages SET
        page_code = ?, sort_order = ?, page_type = ?, section_title = ?, title = ?,
        bullets_json = ?, search_queries_json = ?, sources_json = ?, summary_md = ?,
        draft_svg = ?, design_svg = ?, speaker_notes = ?,
        search_status = ?, summary_status = ?, draft_status = ?, design_status = ?,
        needs_rerun = ?, updated_at = ?
      WHERE id = ?`,
    )
    .run(
      next.page_code,
      next.sort_order,
      next.page_type,
      next.section_title,
      next.title,
      next.bullets_json,
      next.search_queries_json,
      next.sources_json,
      next.summary_md,
      next.draft_svg,
      next.design_svg,
      next.speaker_notes,
      next.search_status,
      next.summary_status,
      next.draft_status,
      next.design_status,
      next.needs_rerun,
      next.updated_at,
      pageId,
    );
  return getPage(pageId);
}

export function reorderPages(projectId: string, orderedPageIds: string[]): PageRow[] {
  const current = listPages(projectId);
  const currentIds = new Set(current.map((page) => page.id));
  if (
    orderedPageIds.length !== current.length ||
    new Set(orderedPageIds).size !== orderedPageIds.length ||
    orderedPageIds.some((id) => !currentIds.has(id))
  ) {
    throw new Error("页面顺序与当前项目不匹配");
  }

  const update = getDb().prepare(
    "UPDATE pages SET sort_order = ?, page_code = ?, updated_at = ? WHERE id = ? AND project_id = ?",
  );
  getDb().transaction(() => {
    orderedPageIds.forEach((pageId, index) => {
      update.run(index, `page-${String(index + 1).padStart(2, "0")}`, nowIso(), pageId, projectId);
    });
  })();
  return listPages(projectId);
}

export function deletePagesNotIn(projectId: string, keepIds: string[]) {
  if (keepIds.length === 0) {
    getDb().prepare("DELETE FROM pages WHERE project_id = ?").run(projectId);
    return;
  }
  const placeholders = keepIds.map(() => "?").join(",");
  getDb()
    .prepare(`DELETE FROM pages WHERE project_id = ? AND id NOT IN (${placeholders})`)
    .run(projectId, ...keepIds);
}

export function addEvent(input: {
  projectId: string;
  pageId?: string | null;
  kind: string;
  title: string;
  detail?: string;
}): EventRow {
  const id = newId("ev");
  const created = nowIso();
  getDb()
    .prepare(
      `INSERT INTO events (id, project_id, page_id, kind, title, detail, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.projectId,
      input.pageId ?? null,
      input.kind,
      input.title,
      input.detail ?? "",
      created,
    );
  return getDb().prepare("SELECT * FROM events WHERE id = ?").get(id) as EventRow;
}

export function listEvents(projectId: string, after?: string): EventRow[] {
  if (after) {
    return getDb()
      .prepare(
        "SELECT * FROM events WHERE project_id = ? AND created_at > ? ORDER BY created_at ASC",
      )
      .all(projectId, after) as EventRow[];
  }
  return getDb()
    .prepare("SELECT * FROM events WHERE project_id = ? ORDER BY created_at ASC")
    .all(projectId) as EventRow[];
}

export function parseAssumptions(project: ProjectRow): ProjectAssumptions {
  return parseAssumptionsJson(project.assumptions_json, {
    pageCount: project.page_count_target,
    styleId: project.style_id,
  });
}
