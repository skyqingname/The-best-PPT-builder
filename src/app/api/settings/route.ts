import { NextResponse } from "next/server";
import { getSettings, saveSettings } from "@/lib/settings";
import { LLM_PROTOCOLS } from "@/lib/types";
import type { AppSettings, LlmProtocol } from "@/lib/types";

export const runtime = "nodejs";

export function GET() {
  return NextResponse.json({
    settings: getSettings(),
    protocols: LLM_PROTOCOLS,
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
  if (
    !protocols.includes(body.text?.protocol) ||
    !protocols.includes(body.svg?.protocol) ||
    !protocols.includes(body.search?.protocol)
  ) {
    return NextResponse.json({ error: "协议不支持" }, { status: 400 });
  }
  const saved = saveSettings({
    text: body.text,
    svg: body.svg,
    search: body.search,
  });
  return NextResponse.json({ settings: saved });
}
