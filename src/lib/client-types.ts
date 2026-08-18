export interface StyleDTO {
  id: string;
  name: string;
  nameEn: string;
  mood: string[];
}

export interface AssumptionQuestionDTO {
  id: string;
  label: string;
  value: string;
  reason: string;
}

export interface AssumptionsDTO {
  pageCount: number;
  audience: string;
  purpose: string;
  styleId: string;
  questions: AssumptionQuestionDTO[];
}

export interface SourceDTO {
  title: string;
  url: string;
  snippet?: string;
}

export interface PageDTO {
  id: string;
  pageCode: string;
  sortOrder: number;
  pageType: "cover" | "toc" | "content" | "end";
  sectionTitle: string | null;
  title: string;
  bullets: string[];
  searchQueries: Array<{ query?: string; query_text?: string; purpose?: string }>;
  sources: SourceDTO[];
  summaryMd: string;
  draftSvg: string;
  designSvg: string;
  speakerNotes: string;
  searchStatus: string;
  summaryStatus: string;
  draftStatus: string;
  designStatus: string;
  needsRerun: boolean;
}

export interface EventDTO {
  id: string;
  pageId: string | null;
  kind: string;
  title: string;
  detail: string;
  createdAt: string;
}

export interface ProjectDTO {
  id: string;
  title: string;
  requestText: string;
  stage: string;
  status: string;
  pageCountTarget: number;
  style: StyleDTO;
  styles: StyleDTO[];
  assumptions: AssumptionsDTO;
  outlineReady: boolean;
  errorText: string | null;
  createdAt: string;
  updatedAt: string;
  pages: PageDTO[];
  events: EventDTO[];
}

export interface ProjectSummaryDTO {
  id: string;
  title: string;
  requestText: string;
  stage: string;
  status: string;
  updatedAt: string;
}
