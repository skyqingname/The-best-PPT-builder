import type { PageRow } from "./types";

export type InvalidationStage = "search" | "draft" | "design";

type InvalidationPatch = Partial<
  Pick<
    PageRow,
    "search_status" | "summary_status" | "draft_status" | "design_status" | "needs_rerun"
  >
>;

export function invalidateFrom(stage: InvalidationStage): InvalidationPatch {
  if (stage === "search") {
    return {
      search_status: "stale",
      summary_status: "stale",
      draft_status: "stale",
      design_status: "stale",
      needs_rerun: 0,
    };
  }
  if (stage === "draft") {
    return {
      draft_status: "stale",
      design_status: "stale",
      needs_rerun: 0,
    };
  }
  return { design_status: "stale", needs_rerun: 0 };
}
