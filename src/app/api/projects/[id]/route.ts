import { NextResponse } from "next/server";
import { serializeProject } from "@/lib/serialize";
import { getProject, listEvents, listPages } from "@/lib/store";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  try {
    const project = getProject(id);
    return NextResponse.json(
      serializeProject(project, listPages(id), listEvents(id)),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "读取失败";
    return NextResponse.json({ error: message }, { status: 404 });
  }
}
