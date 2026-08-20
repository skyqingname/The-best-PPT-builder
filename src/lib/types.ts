export type LlmProtocol =
  | "responses"
  | "messages"
  | "gemini"
  | "chat_completions";

export type ProjectStage =
  | "init"
  | "requirements"
  | "outline"
  | "research"
  | "planning"
  | "draft"
  | "style_reference"
  | "design"
  | "done"
  | "failed";

export type PageType = "cover" | "toc" | "section" | "content" | "end";

export type ArtifactStatus =
  | "empty"
  | "running"
  | "ready"
  | "stale"
  | "failed";

export type ModelSlot = "text" | "svg" | "search";

export interface ModelConfig {
  baseUrl: string;
  apiKey: string;
  protocol: LlmProtocol;
  model: string;
}

export interface AppSettings {
  text: ModelConfig;
  svg: ModelConfig;
  search: ModelConfig;
}

export interface AssumptionQuestion {
  id: string;
  label: string;
  value: string;
  reason: string;
  options: string[];
}

export interface ProjectAssumptions {
  pageCount: number;
  audience: string;
  purpose: string;
  styleId: string;
  questions: AssumptionQuestion[];
}

export type VisualSlotKind =
  | "diagram"
  | "chart"
  | "svg_illustration"
  | "photo"
  | "none";

export interface VisualSlotPlan {
  kind: VisualSlotKind;
  purpose: string;
  placement: string;
  aspectRatio: string;
  query: string;
  fallback: string;
}

export interface DeckVisualSystem {
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
}

export interface DeckPagePlan {
  pageCode: string;
  pageType: PageType;
  title: string;
  objective: string;
  layout: string;
  hierarchy: string[];
  readingOrder: string[];
  visualSlots: VisualSlotPlan[];
}

export interface DeckPlan {
  version: 1;
  status: "ready" | "stale";
  generatedAt: string;
  outlineFingerprint: string;
  shared: DeckVisualSystem;
  pages: DeckPagePlan[];
}

export interface ReferenceStyleProfile {
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
  pageArchetypes: Array<{
    page: string;
    use: string;
    layout: string;
    imageRole: string;
  }>;
  do: string[];
  dont: string[];
}

export interface DesignReferenceState {
  status: "pending" | "processing" | "ready" | "confirmed" | "failed";
  mode: "preset" | "upload";
  styleId: string;
  colorPreference: string;
  uploadId: string;
  fileName: string;
  fileType: "ppt" | "pptx" | "pdf" | "";
  pageCount: number;
  profile: ReferenceStyleProfile | null;
  error: string;
  updatedAt: string;
  confirmedAt: string;
}

export type StructureChatScope = "deck" | "section" | "page";

export interface ProposedStructurePage {
  id: string;
  pageType: PageType;
  sectionTitle: string | null;
  title: string;
  bullets: string[];
}

export interface StructureProposal {
  id: string;
  projectId: string;
  scope: StructureChatScope;
  scopeId: string;
  message: string;
  summary: string;
  pages: ProposedStructurePage[];
  status: "pending" | "applied" | "dismissed";
  createdAt: string;
  appliedAt: string;
}

export interface OutlinePage {
  title: string;
  content: string[];
}

export interface OutlinePart {
  part_title: string;
  pages: OutlinePage[];
}

export interface PptOutline {
  cover: { title: string; sub_title: string; content: string[] };
  table_of_contents: { title: string; content: string[] };
  parts: OutlinePart[];
  end_page: { title: string; content: string[] };
}

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
  content: string;
}

export interface StylePack {
  id: string;
  name: string;
  nameEn: string;
  mood: string[];
  philosophy: string;
  palette: {
    bg: string;
    surface: string;
    text: string;
    muted: string;
    accent: string;
    accent2: string;
    line: string;
  };
  background: string;
  decoration: string;
  dont: string;
}

export interface ProjectRow {
  id: string;
  title: string;
  request_text: string;
  stage: ProjectStage;
  status: "running" | "paused" | "completed" | "failed";
  page_count_target: number;
  style_id: string;
  assumptions_json: string;
  outline_json: string;
  init_sources_json: string;
  error_text: string | null;
  created_at: string;
  updated_at: string;
}

export interface PageRow {
  id: string;
  project_id: string;
  page_code: string;
  sort_order: number;
  page_type: PageType;
  section_title: string | null;
  title: string;
  bullets_json: string;
  search_queries_json: string;
  sources_json: string;
  summary_md: string;
  draft_svg: string;
  design_svg: string;
  speaker_notes: string;
  search_status: ArtifactStatus;
  summary_status: ArtifactStatus;
  draft_status: ArtifactStatus;
  design_status: ArtifactStatus;
  needs_rerun: number;
  created_at: string;
  updated_at: string;
}

export interface EventRow {
  id: string;
  project_id: string;
  page_id: string | null;
  kind: string;
  title: string;
  detail: string;
  created_at: string;
}

export const LLM_PROTOCOLS: { id: LlmProtocol; label: string; hint: string }[] =
  [
    {
      id: "responses",
      label: "OpenAI Responses",
      hint: "/v1/responses",
    },
    {
      id: "messages",
      label: "Messages",
      hint: "/v1/messages",
    },
    {
      id: "gemini",
      label: "Gemini",
      hint: "/v1beta/models",
    },
    {
      id: "chat_completions",
      label: "Chat Completions",
      hint: "/v1/chat/completions",
    },
  ];
