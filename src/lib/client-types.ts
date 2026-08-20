export interface StyleDTO {
  id: string;
  name: string;
  nameEn: string;
  mood: string[];
  philosophy?: string;
  palette?: {
    bg: string;
    surface: string;
    text: string;
    muted: string;
    accent: string;
    accent2: string;
    line: string;
  };
}

export interface AssumptionQuestionDTO {
  id: string;
  label: string;
  value: string;
  reason: string;
  options: string[];
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
  pageType: "cover" | "toc" | "section" | "content" | "end";
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

export interface VisualSlotDTO {
  kind: "diagram" | "chart" | "svg_illustration" | "photo" | "none";
  purpose: string;
  placement: string;
  aspectRatio: string;
  query: string;
  fallback: string;
}

export interface DeckPagePlanDTO {
  pageCode: string;
  pageType: PageDTO["pageType"];
  title: string;
  objective: string;
  layout: string;
  hierarchy: string[];
  readingOrder: string[];
  visualSlots: VisualSlotDTO[];
}

export interface DeckPlanDTO {
  status: "ready" | "stale";
  shared: {
    concept: string;
    canvas: string;
    grid: string;
    margins: string;
    titleSystem: string;
    typography: string;
    palette: string[];
    cardSystem: string;
    graphicLanguage: string;
    consistencyRules: string[];
  };
  pages: DeckPagePlanDTO[];
}

export interface ReferenceStyleProfileDTO {
  name: string;
  summary: string;
  palette: string[];
  typography: string;
  background: string;
  titleSystem: string;
  cardSystem: string;
  imageTreatment: string;
  chartStyle: string;
  density: string;
  pageArchetypes: Array<{ page: string; use: string; layout: string; imageRole: string }>;
  do: string[];
  dont: string[];
}

export interface DesignReferenceDTO {
  status: "pending" | "processing" | "ready" | "confirmed" | "failed";
  mode: "preset" | "upload";
  styleId: string;
  colorPreference: string;
  uploadId: string;
  fileName: string;
  fileType: "ppt" | "pptx" | "pdf" | "";
  pageCount: number;
  profile: ReferenceStyleProfileDTO | null;
  error: string;
  updatedAt: string;
  confirmedAt: string;
}

export interface StructureProposalDTO {
  id: string;
  scope: "deck" | "section" | "page";
  scopeId: string;
  message: string;
  summary: string;
  status: "pending" | "applied" | "dismissed";
  createdAt: string;
  pages: Array<{
    id: string;
    pageType: PageDTO["pageType"];
    sectionTitle: string | null;
    title: string;
    bullets: string[];
  }>;
}

export interface StructureChatMessageDTO {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
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
  requirementsReady: boolean;
  researchSources: SourceDTO[];
  outlineReady: boolean;
  errorText: string | null;
  createdAt: string;
  updatedAt: string;
  pages: PageDTO[];
  events: EventDTO[];
  deckPlan: DeckPlanDTO | null;
  designReference: DesignReferenceDTO;
  structureProposal: StructureProposalDTO | null;
  structureChat: StructureChatMessageDTO[];
}

export interface ProjectSummaryDTO {
  id: string;
  title: string;
  requestText: string;
  stage: string;
  status: string;
  updatedAt: string;
}
