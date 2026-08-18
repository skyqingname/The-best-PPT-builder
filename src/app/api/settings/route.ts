import { NextResponse } from "next/server";
import { getSettings, saveSettings } from "@/lib/settings";
import { LLM_PROTOCOLS } from "@/lib/types";
import type { AppSettings, LlmProtocol, SearchProvider } from "@/lib/types";

export const runtime = "nodejs";

export function GET() {
  return NextResponse.json({
    settings: getSettings(),
    protocols: LLM_PROTOCOLS,
    searchProviders: [
      { id: "tavily", label: "Tavily" },
      { id: "bocha", label: "博查" },
    ],
  });
}

export async function PUT(request: Request) {
  const body = (await request.json()) as AppSettings;
  const protocols: LlmProtocol[] = [
    "responses",
    "messages",
    "gemini",
    "chat_completions",
  ];
  if (!protocols.includes(body.text?.protocol) || !protocols.includes(body.svg?.protocol)) {
    return NextResponse.json({ error: "协议不支持" }, { status: 400 });
  }
  if (!["tavily", "bocha"].includes(body.searchProvider)) {
    return NextResponse.json({ error: "搜索供应商不支持" }, { status: 400 });
  }
  const saved = saveSettings({
    text: body.text,
    svg: body.svg,
    searchProvider: body.searchProvider as SearchProvider,
    searchApiKey: body.searchApiKey ?? "",
  });
  return NextResponse.json({ settings: saved });
}
