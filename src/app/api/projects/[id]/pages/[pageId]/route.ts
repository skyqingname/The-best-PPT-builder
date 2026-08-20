import { NextResponse } from "next/server";
import { applyPageEdit } from "@/lib/pipeline";
import { serializePage } from "@/lib/serialize";
import { getProjectPage } from "@/lib/store";

export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; pageId: string }> },
) {
  const { id, pageId } = await context.params;
  const body = (await request.json()) as {
    title?: string;
    bullets?: string[];
    speakerNotes?: string;
    regenerate?: "research" | "draft" | "design" | "all";
  };
  try {
    await applyPageEdit(id, pageId, body);
    return NextResponse.json(serializePage(getProjectPage(id, pageId)));
  } catch (error) {
    const message = error instanceof Error ? error.message : "更新失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
