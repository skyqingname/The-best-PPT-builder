import { parseAssumptions } from "./store";
import { getStylePack, STYLE_PACKS } from "./styles";
import type { EventRow, PageRow, ProjectRow } from "./types";

export function serializeProject(project: ProjectRow, pages: PageRow[], events: EventRow[] = []) {
  const assumptions = parseAssumptions(project);
  return {
    id: project.id,
    title: project.title,
    requestText: project.request_text,
    stage: project.stage,
    status: project.status,
    pageCountTarget: project.page_count_target,
    style: getStylePack(project.style_id),
    styles: STYLE_PACKS,
    assumptions,
    outlineReady: Boolean(project.outline_json),
    errorText: project.error_text,
    createdAt: project.created_at,
    updatedAt: project.updated_at,
    pages: pages.map(serializePage),
    events: events.map(serializeEvent),
  };
}

export function serializePage(page: PageRow) {
  return {
    id: page.id,
    pageCode: page.page_code,
    sortOrder: page.sort_order,
    pageType: page.page_type,
    sectionTitle: page.section_title,
    title: page.title,
    bullets: JSON.parse(page.bullets_json || "[]") as string[],
    searchQueries: JSON.parse(page.search_queries_json || "[]") as unknown[],
    sources: JSON.parse(page.sources_json || "[]") as unknown[],
    summaryMd: page.summary_md,
    draftSvg: page.draft_svg,
    designSvg: page.design_svg,
    speakerNotes: page.speaker_notes,
    searchStatus: page.search_status,
    summaryStatus: page.summary_status,
    draftStatus: page.draft_status,
    designStatus: page.design_status,
    needsRerun: page.needs_rerun === 1,
  };
}

export function serializeEvent(event: EventRow) {
  return {
    id: event.id,
    pageId: event.page_id,
    kind: event.kind,
    title: event.title,
    detail: event.detail,
    createdAt: event.created_at,
  };
}

export function serializeProjectSummary(project: ProjectRow) {
  return {
    id: project.id,
    title: project.title,
    requestText: project.request_text,
    stage: project.stage,
    status: project.status,
    updatedAt: project.updated_at,
  };
}
