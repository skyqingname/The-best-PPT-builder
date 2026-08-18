import { NextResponse } from "next/server";
import { enqueuePipeline } from "@/lib/pipeline";
import { serializeProjectSummary } from "@/lib/serialize";
import { getSettings } from "@/lib/settings";
import { createProject, listProjects } from "@/lib/store";

export const runtime = "nodejs";

export function GET() {
  return NextResponse.json({
    items: listProjects().map(serializeProjectSummary),
  });
}

export async function POST(request: Request) {
  const body = (await request.json()) as { requestText?: string };
  const requestText = body.requestText?.trim();
  if (!requestText) {
    return NextResponse.json({ error: "先写一句主题" }, { status: 400 });
  }
  try {
    const settings = getSettings();
    if (!settings.text.apiKey || !settings.text.model || !settings.svg.apiKey || !settings.svg.model) {
      return NextResponse.json({ error: "先在设置里配好文本模型和 SVG 模型" }, { status: 400 });
    }
    if (!settings.searchApiKey) {
      return NextResponse.json({ error: "先在设置里填写搜索 API Key" }, { status: 400 });
    }
    const project = createProject(requestText);
    enqueuePipeline(project.id);
    return NextResponse.json({ id: project.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "创建失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
