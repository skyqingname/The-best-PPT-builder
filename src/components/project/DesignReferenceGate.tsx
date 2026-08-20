"use client";

import { useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronRight,
  FileImage,
  FileUp,
  LoaderCircle,
  Palette,
  ScanSearch,
  Sparkles,
  X,
} from "lucide-react";
import type { ProjectDTO } from "@/lib/client-types";

export function DesignReferenceGate({
  project,
  open,
  onClose,
  onUpload,
  onConfirm,
}: {
  project: ProjectDTO;
  open: boolean;
  onClose: () => void;
  onUpload: (file: File) => Promise<boolean>;
  onConfirm: (input: { mode: "preset" | "upload"; styleId: string; colorPreference: string }) => void;
}) {
  const [mode, setMode] = useState<"preset" | "upload">(project.designReference.mode);
  const [styleId, setStyleId] = useState(project.designReference.styleId || project.style.id);
  const [colorPreference, setColorPreference] = useState(project.designReference.colorPreference);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setMode(project.designReference.mode);
    setStyleId(project.designReference.styleId || project.style.id);
    setColorPreference(project.designReference.colorPreference);
  }, [project.designReference, project.style.id]);

  const draftReady = project.pages.filter((page) => page.draftStatus === "ready").length;
  const selectedStyle = project.styles.find((style) => style.id === styleId) ?? project.style;
  const uploadReady = project.designReference.status === "ready" && Boolean(project.designReference.profile);
  const canConfirm = mode === "preset" || uploadReady;

  if (!open) return null;
  return (
    <div className="reference-gate-backdrop" role="dialog" aria-modal="true" aria-label="确认设计参考">
      <div className="reference-gate-shell">
        <div className="reference-gate-rail">
          <div>
            <div className="reference-gate-index">FINAL ART DIRECTION</div>
            <h2>在进入设计稿前，<br />先确定整套视觉语言。</h2>
            <p>初稿已经固定内容、版式与配图意图。这里选择的只是一套视觉系统，不会改写事实。</p>
          </div>
          <div className="reference-gate-progress">
            <div><span>01</span><Check size={14} />内容与结构</div>
            <div><span>02</span><Check size={14} />{draftReady} 页初稿</div>
            <div className="active"><span>03</span><Palette size={14} />设计参考</div>
            <div><span>04</span><Sparkles size={14} />最终设计</div>
          </div>
          <div className="reference-gate-note">确认后，Agent 才会开始逐页完成最终设计。</div>
        </div>

        <div className="reference-gate-main">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-[10px] font-bold tracking-[0.16em] text-[#2f80ff]">DESIGN REFERENCE</div>
              <h3 className="mt-2 text-[25px] font-semibold tracking-[-0.045em]">你有参考的 PPT 格式吗？</h3>
              <p className="mt-2 text-[11px] text-[#7b899b]">选择内置视觉方向，或者上传一份参考稿让模型理解颜色、图片与版式节奏。</p>
            </div>
            <button className="reference-close" onClick={onClose} aria-label="暂时关闭"><X size={17} /></button>
          </div>

          <div className="reference-mode-switch">
            <button className={mode === "preset" ? "active" : ""} onClick={() => setMode("preset")}>
              <Palette size={15} /><span>选择内置风格<small>无需额外模型调用</small></span>
            </button>
            <button className={mode === "upload" ? "active" : ""} onClick={() => setMode("upload")}>
              <FileUp size={15} /><span>上传参考文件<small>PPT / PPTX / PDF</small></span>
            </button>
          </div>

          <div className="custom-scroll min-h-0 flex-1 overflow-y-auto pr-1">
            {mode === "preset" ? (
              <div className="reference-style-grid">
                {project.styles.map((style) => (
                  <button
                    key={style.id}
                    className={styleId === style.id ? "reference-style-card active" : "reference-style-card"}
                    onClick={() => setStyleId(style.id)}
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="text-[12px] font-semibold">{style.name}</div>
                        <div className="mt-0.5 text-[8px] tracking-[0.08em] text-[#8a96a6]">{style.nameEn}</div>
                      </div>
                      {styleId === style.id && <span className="style-selected"><Check size={11} /></span>}
                    </div>
                    <div className="style-palette-row">
                      {style.palette && [style.palette.bg, style.palette.surface, style.palette.accent, style.palette.accent2, style.palette.text].map((color) => (
                        <span key={color} style={{ background: color }} />
                      ))}
                    </div>
                    <p>{style.philosophy}</p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {style.mood.slice(0, 3).map((mood) => <span className="style-mood" key={mood}>{mood}</span>)}
                    </div>
                  </button>
                ))}
                <label className="reference-color-note">
                  <span>颜色补充偏好</span>
                  <input
                    value={colorPreference}
                    onChange={(event) => setColorPreference(event.target.value)}
                    placeholder={`例如：保留 ${selectedStyle.name}，但降低蓝色饱和度`}
                  />
                </label>
              </div>
            ) : (
              <div className="reference-upload-panel">
                <input
                  ref={inputRef}
                  className="sr-only"
                  type="file"
                  accept=".ppt,.pptx,.pdf,application/pdf,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation"
                  onChange={async (event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    setUploading(true);
                    await onUpload(file);
                    setUploading(false);
                    event.target.value = "";
                  }}
                />
                <button className="reference-drop-zone" onClick={() => inputRef.current?.click()} disabled={uploading}>
                  <span className="reference-file-icon">{uploading ? <LoaderCircle className="animate-spin" size={22} /> : <FileImage size={22} />}</span>
                  <strong>{uploading ? "正在保存参考文件" : project.designReference.fileName || "选择一份参考演示"}</strong>
                  <span>最大 50MB · 最多分析 40 页 · 文件只保存在本机</span>
                </button>

                <ReferenceAnalysis project={project} />
              </div>
            )}
          </div>

          <div className="reference-gate-actions">
            <div>
              <span className="block text-[9px] text-[#8a97a8]">即将采用</span>
              <strong className="mt-0.5 block text-[11px]">
                {mode === "preset" ? selectedStyle.name : project.designReference.profile?.name || "等待分析参考稿"}
              </strong>
            </div>
            <button
              disabled={!canConfirm || project.designReference.status === "processing"}
              onClick={() => onConfirm({ mode, styleId, colorPreference })}
            >
              确认并开始最终设计<ChevronRight size={15} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ReferenceAnalysis({ project }: { project: ProjectDTO }) {
  const reference = project.designReference;
  const profile = reference.profile;
  if (reference.status === "processing") {
    return (
      <div className="reference-analysis processing">
        <LoaderCircle size={18} className="animate-spin" />
        <div><strong>正在理解参考稿</strong><span>提取代表页面的颜色、图文关系与版式规律</span></div>
      </div>
    );
  }
  if (reference.status === "failed") {
    return <div className="reference-analysis failed"><X size={17} /><div><strong>分析失败</strong><span>{reference.error}</span></div></div>;
  }
  if (!profile) {
    return (
      <div className="reference-analysis waiting">
        <ScanSearch size={18} />
        <div><strong>分析内容</strong><span>配色、字阶、卡片、图表、配图位置与页面节奏</span></div>
      </div>
    );
  }
  return (
    <div className="reference-profile-card">
      <div className="flex items-start justify-between">
        <div><div className="text-[12px] font-semibold">{profile.name}</div><p>{profile.summary}</p></div>
        <span>{reference.pageCount} 页</span>
      </div>
      <div className="reference-profile-palette">
        {profile.palette.map((color) => <span key={color} style={{ background: color }} title={color} />)}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <ProfileFact label="标题系统" value={profile.titleSystem} />
        <ProfileFact label="图片处理" value={profile.imageTreatment} />
        <ProfileFact label="卡片语言" value={profile.cardSystem} />
        <ProfileFact label="信息密度" value={profile.density} />
      </div>
    </div>
  );
}

function ProfileFact({ label, value }: { label: string; value: string }) {
  return <div className="reference-profile-fact"><span>{label}</span><p>{value || "已从参考页提取"}</p></div>;
}
