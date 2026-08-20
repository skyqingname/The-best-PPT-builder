import { NextResponse } from "next/server";
import { completeChat, extractJsonObject } from "@/lib/llm";
import {
  applyAssumptionPatch,
  applyPageEdit,
  applyPageOrder,
  confirmRequirements,
  enqueuePipeline,
  requestCancel,
} from "@/lib/pipeline";
import { PAGE_PATCH_SYSTEM } from "@/lib/prompts";
import { serializeProject } from "@/lib/serialize";
import { requireTextConfig } from "@/lib/settings";
import { getProject, getProjectPage, listEvents, listPages, parseAssumptions } from "@/lib/store";
import type { ProjectAssumptions } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const body = (await request.json()) as {
    type?: string;
    assumptions?: Partial<ProjectAssumptions>;
    pageId?: string;
    message?: string;
    surface?: "search" | "draft" | "design";
    pageIds?: string[];
  };

  try {
    getProject(id);
    if (body.type === "resume") {
      enqueuePipeline(id);
    } else if (body.type === "cancel") {
      requestCancel(id);
    } else if (body.type === "updateAssumptions") {
      await applyAssumptionPatch(id, body.assumptions ?? {});
    } else if (body.type === "confirmRequirements") {
      confirmRequirements(id, body.assumptions ?? {});
    } else if (body.type === "reorderPages") {
      await applyPageOrder(id, body.pageIds ?? []);
    } else if (body.type === "chat") {
      if (!body.pageId || !body.message?.trim()) {
        return NextResponse.json({ error: "缺少页或内容" }, { status: 400 });
      }
      const page = getProjectPage(id, body.pageId);
      const project = getProject(id);
      const raw = await completeChat(requireTextConfig(), [
        { role: "system", content: PAGE_PATCH_SYSTEM },
        {
          role: "user",
          content: JSON.stringify({
            message: body.message,
            surface: body.surface ?? "design",
            page: {
              title: page.title,
              bullets: JSON.parse(page.bullets_json || "[]"),
              speaker_notes: page.speaker_notes,
            },
            assumptions: parseAssumptions(project),
          }),
        },
      ]);
      const patch = extractJsonObject(raw) as {
        title?: string | null;
        content_outline?: string[] | null;
        speaker_notes?: string | null;
        render_instruction?: string;
      };
      const regen =
        body.surface === "design"
          ? "design"
          : body.surface === "draft"
            ? "draft"
            : "all";
      await applyPageEdit(id, body.pageId, {
        title: patch.title || undefined,
        bullets: patch.content_outline || undefined,
        speakerNotes: patch.speaker_notes || undefined,
        instruction: patch.render_instruction || body.message,
        regenerate: regen,
      });
    } else {
      return NextResponse.json({ error: "未知动作" }, { status: 400 });
    }

    return NextResponse.json(
      serializeProject(getProject(id), listPages(id), listEvents(id)),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "动作失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
