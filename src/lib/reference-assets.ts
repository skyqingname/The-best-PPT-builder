import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import JSZip from "jszip";
import { generateJson } from "./model-gateway";
import { REFERENCE_STYLE_SYSTEM } from "./prompts";
import {
  getReferenceRenderDir,
  getReferenceState,
  getReferenceUploadPath,
  saveReferenceState,
} from "./project-artifacts";
import { requireSvgConfig } from "./settings";
import { getProject } from "./store";
import type { ChatContentPart } from "./llm";
import type { ReferenceStyleProfile } from "./types";

const execFileAsync = promisify(execFile);

export interface ReferenceAnalysisRuntime {
  signal: AbortSignal;
  assertActive: () => void;
  log: (title: string, detail?: string, kind?: string) => void;
  onRetry: (input: { attempt: number; maxAttempts: number; delayMs: number }) => void;
}

interface RawReferenceProfile {
  name?: string;
  summary?: string;
  palette?: string[];
  typography?: string;
  background?: string;
  title_system?: string;
  card_system?: string;
  image_treatment?: string;
  chart_style?: string;
  density?: string;
  page_archetypes?: Array<{
    page?: string;
    use?: string;
    layout?: string;
    image_role?: string;
  }>;
  do?: string[];
  dont?: string[];
}

export async function validateReferenceUpload(
  fileName: string,
  bytes: Buffer,
): Promise<"ppt" | "pptx" | "pdf"> {
  if (bytes.byteLength === 0) throw new Error("参考文件为空");
  if (bytes.byteLength > 50 * 1024 * 1024) throw new Error("参考文件不能超过 50MB");
  const extension = path.extname(fileName).toLowerCase();
  if (extension === ".pptm" || extension === ".ppsm") {
    throw new Error("不接受带宏的演示文件，请另存为 PPTX 或 PDF");
  }
  if (extension === ".pdf") {
    if (bytes.subarray(0, 5).toString("ascii") !== "%PDF-") throw new Error("PDF 文件签名不正确");
    return "pdf";
  }
  if (extension === ".ppt") {
    const signature = bytes.subarray(0, 8).toString("hex");
    if (signature !== "d0cf11e0a1b11ae1") throw new Error("PPT 文件签名不正确");
    return "ppt";
  }
  if (extension === ".pptx") {
    if (bytes.subarray(0, 2).toString("ascii") !== "PK") throw new Error("PPTX 文件签名不正确");
    const zip = await JSZip.loadAsync(bytes);
    if (!zip.file("[Content_Types].xml") || !zip.file("ppt/presentation.xml")) {
      throw new Error("PPTX 结构不完整");
    }
    return "pptx";
  }
  throw new Error("只支持 PPT、PPTX 或 PDF 参考文件");
}

export async function analyzeReferenceFile(
  projectId: string,
  runtime: ReferenceAnalysisRuntime,
) {
  const project = getProject(projectId);
  const state = getReferenceState(projectId, project.style_id);
  if (!state.uploadId || !state.fileType) throw new Error("没有等待分析的参考文件");
  const sourcePath = getReferenceUploadPath(projectId, state.uploadId, state.fileType);
  if (!fs.existsSync(sourcePath)) throw new Error("参考文件不存在");

  saveReferenceState(projectId, { ...state, status: "processing", error: "" });
  runtime.log("正在理解参考稿", state.fileName, "info");
  try {
    const renderDir = getReferenceRenderDir(projectId, state.uploadId);
    const pdfPath = state.fileType === "pdf"
      ? sourcePath
      : await convertOfficeToPdf(sourcePath, renderDir, runtime.signal);
    runtime.assertActive();
    const pageCount = await readPdfPageCount(pdfPath, runtime.signal);
    if (pageCount < 1) throw new Error("参考文件没有可分析页面");
    if (pageCount > 40) throw new Error("参考文件最多分析 40 页");
    const pages = samplePages(pageCount, 12);
    const images = await renderPdfPages(pdfPath, renderDir, pages, runtime.signal);
    runtime.assertActive();

    const content: ChatContentPart[] = [
      {
        type: "text",
        text: JSON.stringify({
          file_name: state.fileName,
          page_count: pageCount,
          sampled_pages: pages,
          instruction: "按输入顺序分析代表性页面，提取整套可复用视觉系统",
        }),
      },
      ...images.map((image) => ({
        type: "image" as const,
        mimeType: "image/jpeg" as const,
        data: fs.readFileSync(image).toString("base64"),
      })),
    ];
    const raw = await generateJson<RawReferenceProfile>(requireSvgConfig(), [
      { role: "system", content: REFERENCE_STYLE_SYSTEM },
      { role: "user", content },
    ], {
      signal: runtime.signal,
      timeoutMs: 240_000,
      onRetry: runtime.onRetry,
    });
    runtime.assertActive();
    const profile = normalizeProfile(raw);
    saveReferenceState(projectId, {
      ...state,
      status: "ready",
      pageCount,
      profile,
      error: "",
    });
    runtime.log("参考稿分析已就绪", profile.name, "success");
  } catch (error) {
    if (runtime.signal.aborted) throw new Error("CANCELLED");
    const message = error instanceof Error ? error.message : "参考稿分析失败";
    saveReferenceState(projectId, { ...state, status: "failed", error: message });
    runtime.log("参考稿分析失败", message, "error");
    throw error;
  }
}

async function convertOfficeToPdf(
  sourcePath: string,
  outputDir: string,
  signal: AbortSignal,
): Promise<string> {
  const soffice = await resolveExecutable(["soffice", "libreoffice"], signal);
  if (!soffice) throw new Error("未找到 LibreOffice，无法分析 PPT；可以改传 PDF");
  const profileDir = path.join(outputDir, `lo-profile-${Date.now().toString(36)}`);
  fs.mkdirSync(profileDir, { recursive: true });
  await execFileAsync(soffice, [
    "--headless",
    `-env:UserInstallation=file://${profileDir}`,
    "--convert-to",
    "pdf",
    "--outdir",
    outputDir,
    sourcePath,
  ], { signal, timeout: 120_000, maxBuffer: 2 * 1024 * 1024 });
  const expected = path.join(outputDir, `${path.basename(sourcePath, path.extname(sourcePath))}.pdf`);
  if (!fs.existsSync(expected)) throw new Error("LibreOffice 没有生成可分析的 PDF");
  return expected;
}

async function readPdfPageCount(pdfPath: string, signal: AbortSignal): Promise<number> {
  const pdfinfo = await resolveExecutable(["pdfinfo"], signal);
  if (!pdfinfo) throw new Error("未找到 Poppler pdfinfo，无法读取参考稿");
  const { stdout } = await execFileAsync(pdfinfo, [pdfPath], {
    signal,
    timeout: 30_000,
    maxBuffer: 2 * 1024 * 1024,
  });
  return Number(stdout.match(/^Pages:\s+(\d+)/m)?.[1] || 0);
}

async function renderPdfPages(
  pdfPath: string,
  outputDir: string,
  pages: number[],
  signal: AbortSignal,
): Promise<string[]> {
  const pdftoppm = await resolveExecutable(["pdftoppm"], signal);
  if (!pdftoppm) throw new Error("未找到 Poppler pdftoppm，无法生成参考页预览");
  const output: string[] = [];
  for (const pageNumber of pages) {
    const prefix = path.join(outputDir, `page-${String(pageNumber).padStart(3, "0")}`);
    await execFileAsync(pdftoppm, [
      "-f", String(pageNumber),
      "-l", String(pageNumber),
      "-singlefile",
      "-jpeg",
      "-jpegopt", "quality=78",
      "-scale-to-x", "720",
      "-scale-to-y", "-1",
      pdfPath,
      prefix,
    ], { signal, timeout: 45_000, maxBuffer: 2 * 1024 * 1024 });
    const filePath = `${prefix}.jpg`;
    if (!fs.existsSync(filePath)) throw new Error(`参考稿第 ${pageNumber} 页渲染失败`);
    output.push(filePath);
  }
  return output;
}

async function resolveExecutable(candidates: string[], signal: AbortSignal): Promise<string | null> {
  for (const candidate of candidates) {
    try {
      const { stdout } = await execFileAsync("which", [candidate], {
        signal,
        timeout: 5_000,
        maxBuffer: 64 * 1024,
      });
      const value = stdout.trim();
      if (value) return value;
    } catch {
      if (signal.aborted) throw new Error("CANCELLED");
    }
  }
  return null;
}

function samplePages(total: number, max: number): number[] {
  if (total <= max) return Array.from({ length: total }, (_, index) => index + 1);
  const values = new Set<number>([1, total]);
  for (let index = 1; index < max - 1; index += 1) {
    values.add(Math.round(1 + (index * (total - 1)) / (max - 1)));
  }
  return [...values].sort((a, b) => a - b).slice(0, max);
}

function normalizeProfile(raw: RawReferenceProfile): ReferenceStyleProfile {
  const palette = (raw.palette ?? [])
    .map(clean)
    .filter((color) => /^#[0-9a-f]{6}$/i.test(color))
    .slice(0, 6);
  return {
    name: clean(raw.name) || "上传参考稿",
    summary: clean(raw.summary) || "沿用参考稿的版式节奏、图文关系与颜色秩序",
    palette: palette.length >= 3 ? palette : ["#F7F8FA", "#17243A", "#2F80FF"],
    typography: clean(raw.typography),
    background: clean(raw.background),
    titleSystem: clean(raw.title_system),
    cardSystem: clean(raw.card_system),
    imageTreatment: clean(raw.image_treatment),
    chartStyle: clean(raw.chart_style),
    density: clean(raw.density),
    pageArchetypes: (raw.page_archetypes ?? []).slice(0, 8).map((item) => ({
      page: clean(item.page),
      use: clean(item.use),
      layout: clean(item.layout),
      imageRole: clean(item.image_role),
    })).filter((item) => item.layout || item.use),
    do: cleanList(raw.do),
    dont: cleanList(raw.dont),
  };
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, 800) : "";
}

function cleanList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(clean).filter(Boolean).slice(0, 12) : [];
}
