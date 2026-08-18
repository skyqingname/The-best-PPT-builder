import { buildPptx } from "@/lib/export-pptx";
import { getProject, listPages } from "@/lib/store";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  try {
    const project = getProject(id);
    const pages = listPages(id);
    const svgs = pages
      .map((page) => page.design_svg || page.draft_svg)
      .filter((item) => item.trim().length > 0);
    const buffer = await buildPptx(svgs);
    const filename = `${project.title || "ppt-agent"}.pptx`.replace(/[\\/:*?"<>|]/g, "_");
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "导出失败";
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
}
