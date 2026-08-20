import { NextResponse } from "next/server";
import { serializeProjectSummary } from "@/lib/serialize";
import { isAppConfigured } from "@/lib/settings";
import { listProjects } from "@/lib/store";

export const runtime = "nodejs";

export function GET() {
  return NextResponse.json({
    projects: listProjects().map(serializeProjectSummary),
    configured: isAppConfigured(),
  });
}
