export type LlmProtocol =
  | "responses"
  | "messages"
  | "gemini"
  | "chat_completions";

export type SearchProvider = "tavily" | "bocha";

export type ProjectStage =
  | "init"
  | "outline"
  | "research"
  | "draft"
  | "design"
  | "done"
  | "failed";

export type PageType = "cover" | "toc" | "content" | "end";

export type ArtifactStatus =
  | "empty"
  | "running"
  | "ready"
  | "stale"
  | "failed";

export type ModelSlot = "text" | "svg";

export interface ModelConfig {
  baseUrl: string;
  apiKey: string;
  protocol: LlmProtocol;
  model: string;
}

export interface AppSettings {
  text: ModelConfig;
  svg: ModelConfig;
  searchProvider: SearchProvider;
  searchApiKey: string;
}

export interface AssumptionQuestion {
  id: string;
  label: string;
  value: string;
  reason: string;
}

export interface ProjectAssumptions {
  pageCount: number;
  audience: string;
  purpose: string;
  styleId: string;
  questions: AssumptionQuestion[];
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
