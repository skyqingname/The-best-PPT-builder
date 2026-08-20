import { NextResponse } from "next/server";
import { enqueueReferenceAnalysis } from "@/lib/pipeline";
import {
  createArtifactId,
  getReferenceState,
  saveReferenceState,
  saveReferenceUpload,
} from "@/lib/project-artifacts";
import { validateReferenceUpload } from "@/lib/reference-assets";
import { serializeProject } from "@/lib/serialize";
import { getProject, listEvents, listPages } from "@/lib/store";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  try {
    const project = getProject(id);
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "请选择 PPT、PPTX 或 PDF 文件" }, { status: 400 });
    }
    const bytes = Buffer.from(await file.arrayBuffer());
    const fileType = await validateReferenceUpload(file.name, bytes);
    const uploadId = createArtifactId("ref");
    saveReferenceUpload({ projectId: id, uploadId, fileName: file.name, bytes });
    const current = getReferenceState(id, project.style_id);
    saveReferenceState(id, {
      ...current,
      status: "processing",
      mode: "upload",
      uploadId,
      fileName: file.name.replace(/[\u0000-\u001f]/g, "").slice(0, 180),
      fileType,
      pageCount: 0,
      profile: null,
      error: "",
      confirmedAt: "",
    });
    enqueueReferenceAnalysis(id);
    return NextResponse.json(
      serializeProject(getProject(id), listPages(id), listEvents(id)),
      { status: 202 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "参考文件上传失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
