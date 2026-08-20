import { NextResponse } from "next/server";
import {
  applyAssumptionPatch,
  applyStructureProposal,
  applyPageOrder,
  confirmDesignReference,
  confirmRequirements,
  dismissStructureProposal,
  enqueueStructureMessage,
  enqueuePageMessage,
  enqueuePipeline,
  requestCancel,
} from "@/lib/pipeline";
import { serializeProject } from "@/lib/serialize";
import { getProject, listEvents, listPages } from "@/lib/store";
import type { ProjectAssumptions } from "@/lib/types";
import type { StructureChatScope } from "@/lib/types";

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
    scope?: StructureChatScope;
    scopeId?: string;
    proposalId?: string;
    mode?: "preset" | "upload";
    styleId?: string;
    colorPreference?: string;
  };

  try {
    let responseStatus = 200;
    getProject(id);
    if (body.type === "resume") {
      enqueuePipeline(id);
      responseStatus = 202;
    } else if (body.type === "cancel") {
      requestCancel(id);
    } else if (body.type === "updateAssumptions") {
      await applyAssumptionPatch(id, body.assumptions ?? {});
      responseStatus = 202;
    } else if (body.type === "confirmRequirements") {
      confirmRequirements(id, body.assumptions ?? {});
      responseStatus = 202;
    } else if (body.type === "reorderPages") {
      await applyPageOrder(id, body.pageIds ?? []);
      responseStatus = 202;
    } else if (body.type === "chat") {
      if (!body.pageId || !body.message?.trim()) {
        return NextResponse.json({ error: "缺少页或内容" }, { status: 400 });
      }
      enqueuePageMessage(id, {
        pageId: body.pageId,
        message: body.message,
        surface: body.surface ?? "design",
      });
      responseStatus = 202;
    } else if (body.type === "structureChat") {
      if (!body.message?.trim() || !body.scope) {
        return NextResponse.json({ error: "缺少结构修改内容或范围" }, { status: 400 });
      }
      enqueueStructureMessage(id, {
        message: body.message,
        scope: body.scope,
        scopeId: body.scopeId,
      });
      responseStatus = 202;
    } else if (body.type === "applyStructureProposal") {
      if (!body.proposalId) {
        return NextResponse.json({ error: "缺少结构提案" }, { status: 400 });
      }
      await applyStructureProposal(id, body.proposalId);
      responseStatus = 202;
    } else if (body.type === "dismissStructureProposal") {
      if (!body.proposalId) {
        return NextResponse.json({ error: "缺少结构提案" }, { status: 400 });
      }
      dismissStructureProposal(id, body.proposalId);
    } else if (body.type === "confirmDesignReference") {
      if (!body.mode) {
        return NextResponse.json({ error: "请选择设计参考方式" }, { status: 400 });
      }
      await confirmDesignReference(id, {
        mode: body.mode,
        styleId: body.styleId,
        colorPreference: body.colorPreference,
      });
      responseStatus = 202;
    } else {
      return NextResponse.json({ error: "未知动作" }, { status: 400 });
    }

    return NextResponse.json(
      serializeProject(getProject(id), listPages(id), listEvents(id)),
      { status: responseStatus },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "动作失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
