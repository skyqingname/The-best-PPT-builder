import type { ProjectAssumptions } from "./types";

export function parseAssumptionsJson(
  json: string,
  fallback: { pageCount: number; styleId: string },
): ProjectAssumptions {
  try {
    const parsed = JSON.parse(json) as Partial<ProjectAssumptions>;
    return {
      pageCount: parsed.pageCount || fallback.pageCount,
      audience: parsed.audience || "",
      purpose: parsed.purpose || "",
      styleId: parsed.styleId || fallback.styleId,
      questions: (parsed.questions || []).map((question, index) => ({
        id: question.id || `q${index + 1}`,
        label: question.label || `问题 ${index + 1}`,
        value: question.value || "",
        reason: question.reason || "",
        options: Array.isArray(question.options)
          ? question.options.filter((option): option is string => Boolean(option?.trim()))
          : [],
      })),
    };
  } catch {
    return {
      pageCount: fallback.pageCount,
      audience: "",
      purpose: "",
      styleId: fallback.styleId,
      questions: [],
    };
  }
}
