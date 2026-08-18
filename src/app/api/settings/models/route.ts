import { NextResponse } from "next/server";
import { listModels } from "@/lib/llm";
import type { LlmProtocol } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = (await request.json()) as {
    baseUrl?: string;
    apiKey?: string;
    protocol?: LlmProtocol;
  };
  try {
    const models = await listModels({
      baseUrl: body.baseUrl || "",
      apiKey: body.apiKey || "",
      protocol: body.protocol || "chat_completions",
    });
    return NextResponse.json({ models });
  } catch (error) {
    const message = error instanceof Error ? error.message : "拉取失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
