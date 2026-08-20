import fs from "node:fs";
import path from "node:path";
import type {
  DeckPlan,
  DesignReferenceState,
  StructureProposal,
} from "./types";

const artifactsRoot = path.join(process.cwd(), "data", "artifacts");

function assertSafeSegment(value: string, label: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) throw new Error(`${label} 不合法`);
  return value;
}

function projectDir(projectId: string): string {
  return path.join(artifactsRoot, assertSafeSegment(projectId, "项目 ID"));
}

function readJson<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function writeJson(filePath: string, value: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${Date.now().toString(36)}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2), "utf8");
  fs.renameSync(tempPath, filePath);
}

export function getDeckPlan(projectId: string): DeckPlan | null {
  return readJson<DeckPlan>(path.join(projectDir(projectId), "deck-plan.json"));
}

export function saveDeckPlan(projectId: string, plan: DeckPlan): DeckPlan {
  writeJson(path.join(projectDir(projectId), "deck-plan.json"), plan);
  return plan;
}

export function markDeckPlanStale(projectId: string): DeckPlan | null {
  const current = getDeckPlan(projectId);
  if (!current || current.status === "stale") return current;
  return saveDeckPlan(projectId, { ...current, status: "stale" });
}

export function defaultReferenceState(styleId: string): DesignReferenceState {
  return {
    status: "pending",
    mode: "preset",
    styleId,
    colorPreference: "",
    uploadId: "",
    fileName: "",
    fileType: "",
    pageCount: 0,
    profile: null,
    error: "",
    updatedAt: "",
    confirmedAt: "",
  };
}

export function getReferenceState(
  projectId: string,
  styleId: string,
): DesignReferenceState {
  return readJson<DesignReferenceState>(
    path.join(projectDir(projectId), "reference-state.json"),
  ) ?? defaultReferenceState(styleId);
}

export function saveReferenceState(
  projectId: string,
  state: DesignReferenceState,
): DesignReferenceState {
  const next = { ...state, updatedAt: new Date().toISOString() };
  writeJson(path.join(projectDir(projectId), "reference-state.json"), next);
  return next;
}

export function saveReferenceUpload(input: {
  projectId: string;
  uploadId: string;
  fileName: string;
  bytes: Buffer;
}): string {
  const uploadId = assertSafeSegment(input.uploadId, "上传 ID");
  const extension = path.extname(input.fileName).toLowerCase();
  const filePath = path.join(projectDir(input.projectId), "references", uploadId, `source${extension}`);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, input.bytes, { flag: "wx" });
  return filePath;
}

export function getReferenceUploadPath(
  projectId: string,
  uploadId: string,
  fileType: string,
): string {
  return path.join(
    projectDir(projectId),
    "references",
    assertSafeSegment(uploadId, "上传 ID"),
    `source.${fileType}`,
  );
}

export function getReferenceRenderDir(projectId: string, uploadId: string): string {
  const target = path.join(
    projectDir(projectId),
    "references",
    assertSafeSegment(uploadId, "上传 ID"),
    "render",
  );
  fs.mkdirSync(target, { recursive: true });
  return target;
}

export function listStructureProposals(projectId: string): StructureProposal[] {
  return readJson<StructureProposal[]>(
    path.join(projectDir(projectId), "structure-proposals.json"),
  ) ?? [];
}

export function getLatestStructureProposal(projectId: string): StructureProposal | null {
  return [...listStructureProposals(projectId)]
    .reverse()
    .find((proposal) => proposal.status === "pending") ?? null;
}

export function saveStructureProposal(
  projectId: string,
  proposal: StructureProposal,
): StructureProposal {
  const current = listStructureProposals(projectId);
  const next = [...current.filter((item) => item.id !== proposal.id), proposal].slice(-20);
  writeJson(path.join(projectDir(projectId), "structure-proposals.json"), next);
  return proposal;
}

export function updateStructureProposal(
  projectId: string,
  proposalId: string,
  patch: Partial<StructureProposal>,
): StructureProposal {
  const current = listStructureProposals(projectId);
  const index = current.findIndex((proposal) => proposal.id === proposalId);
  if (index < 0) throw new Error("结构修改提案不存在");
  const next = { ...current[index], ...patch };
  current[index] = next;
  writeJson(path.join(projectDir(projectId), "structure-proposals.json"), current);
  return next;
}

export function createArtifactId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}
