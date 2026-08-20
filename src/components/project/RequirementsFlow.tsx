"use client";

import { useEffect, useState } from "react";
import type {
  AssumptionsDTO,
  AssumptionQuestionDTO,
  ProjectDTO,
} from "@/lib/client-types";
import { ProjectIcon as Icon } from "./ProjectIcon";

export function RequirementsFlow({
  project,
  error,
  onBack,
  onSettings,
  onSubmit,
  onResume,
}: {
  project: ProjectDTO;
  error: string;
  onBack: () => void;
  onSettings: () => void;
  onSubmit: (assumptions: AssumptionsDTO) => Promise<boolean>;
  onResume: () => void;
}) {
  const [draft, setDraft] = useState(project.assumptions);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [customIds, setCustomIds] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const snapshot = JSON.stringify(project.assumptions);

  useEffect(() => {
    if (!dirty) setDraft(project.assumptions);
  }, [snapshot, dirty, project.assumptions]);

  useEffect(() => {
    if (project.status === "failed") setSubmitting(false);
  }, [project.status]);

  const ready = project.requirementsReady && draft.questions.length > 0;
  const question = draft.questions[questionIndex];
  const allAnswered = draft.questions.every((item) => item.value.trim());

  function updateMeta(patch: Partial<AssumptionsDTO>) {
    setDirty(true);
    setDraft((current) => ({ ...current, ...patch }));
  }

  function setQuestionValue(target: AssumptionQuestionDTO, value: string, custom = false) {
    setDirty(true);
    setCustomIds((current) =>
      custom
        ? Array.from(new Set([...current, target.id]))
        : current.filter((id) => id !== target.id),
    );
    setDraft((current) => {
      const next: AssumptionsDTO = {
        ...current,
        questions: current.questions.map((item) =>
          item.id === target.id ? { ...item, value } : item,
        ),
      };
      if (/页数|篇幅/.test(target.label)) {
        const numbers = value.match(/\d+/g)?.map(Number) ?? [];
        if (numbers.length) next.pageCount = Math.min(16, Math.max(8, numbers.at(-1) ?? 12));
      }
      if (/受众|听众|对象/.test(target.label) && value) next.audience = value;
      if (/目的|目标/.test(target.label) && value) next.purpose = value;
      return next;
    });
  }

  async function submit() {
    if (!allAnswered) return;
    setSubmitting(true);
    const saved = await onSubmit(draft);
    if (!saved) setSubmitting(false);
  }

  return (
    <div className="requirements-shell min-h-dvh text-[#15233a]">
      <header className="flex h-[62px] items-center justify-between border-b border-[#e8edf5] bg-white/90 px-4 backdrop-blur md:px-7">
        <button className="ui-icon-button" onClick={onBack} aria-label="返回首页">
          <Icon name="back" size={18} />
        </button>
        <div className="min-w-0 px-4 text-center">
          <div className="truncate text-[14px] font-semibold md:text-[15px]">{project.title}</div>
          <div className="mt-0.5 text-[10px] font-medium tracking-[0.16em] text-[#9aa8ba]">
            REQUIREMENT BRIEF
          </div>
        </div>
        <button className="ui-icon-button" onClick={onSettings} aria-label="打开设置">
          <Icon name="settings" size={18} />
        </button>
      </header>

      <main className="mx-auto w-full max-w-[760px] px-4 py-8 md:px-6 md:py-12">
        <div className="ml-auto max-w-[78%] animate-rise">
          <div className="rounded-[24px_24px_7px_24px] bg-[#2f80ff] px-5 py-3.5 text-[15px] leading-6 text-white shadow-[0_12px_28px_rgba(47,128,255,0.22)] md:text-[16px]">
            {project.requestText}
          </div>
          <div className="mt-2 pr-1 text-right text-[11px] text-[#9aabc1]">你的项目主题</div>
        </div>

        <div className="mt-9 space-y-5">
          <TimelineLine
            complete={project.researchSources.length > 0 || ready}
            active={!ready}
            label={ready ? "背景调研完成" : "正在进行背景调研，收集相关资料…"}
          />

          {!ready ? (
            <ResearchLoading project={project} onResume={onResume} />
          ) : (
            <>
              <ResearchReceipt project={project} />
              <p className="animate-rise text-[16px] leading-7 text-[#34445b] md:text-[17px]">
                背景调研已完成。下面是影响大纲结构的关键需求，推荐项已经代选，你可以直接提交或逐项调整。
              </p>

              <section className="animate-rise overflow-hidden rounded-[24px] border border-[#cfe0fb] bg-white shadow-[0_18px_54px_rgba(30,80,140,0.09)]">
                <div className="flex items-center justify-between border-b border-[#dbe8fb] bg-[#eef5ff] px-5 py-4">
                  <div className="flex items-center gap-3 text-[15px] font-semibold text-[#1765dc]">
                    <span className="grid h-8 w-8 place-items-center rounded-full bg-[#2f80ff] text-white">
                      <Icon name="target" size={17} />
                    </span>
                    内容需求单
                  </div>
                  <span className="text-[14px] font-semibold text-[#2f80ff]">
                    {questionIndex + 1}/{draft.questions.length}
                  </span>
                </div>

                <div className="px-5 py-5 md:px-6 md:py-6">
                  <details className="mb-5 rounded-[14px] border border-[#e8eef7] bg-[#f9fbfe]">
                    <summary className="cursor-pointer list-none px-4 py-3 text-[12px] font-medium text-[#6f8199]">
                      基础设定 · {draft.pageCount} 页 · {draft.audience}
                    </summary>
                    <div className="grid gap-3 border-t border-[#e8eef7] p-4 md:grid-cols-[110px_1fr]">
                      <label className="text-[11px] text-[#7c8da4]">
                        总页数
                        <input
                          type="number"
                          min={8}
                          max={16}
                          value={draft.pageCount}
                          onChange={(event) => updateMeta({ pageCount: Number(event.target.value) })}
                          className="form-field mt-1"
                        />
                      </label>
                      <label className="text-[11px] text-[#7c8da4]">
                        核心受众
                        <input
                          value={draft.audience}
                          onChange={(event) => updateMeta({ audience: event.target.value })}
                          className="form-field mt-1"
                        />
                      </label>
                      <label className="text-[11px] text-[#7c8da4] md:col-span-2">
                        演示目标
                        <input
                          value={draft.purpose}
                          onChange={(event) => updateMeta({ purpose: event.target.value })}
                          className="form-field mt-1"
                        />
                      </label>
                    </div>
                  </details>

                  {question && (
                    <div key={question.id} className="animate-question">
                      <div className="text-[12px] font-semibold text-[#2f80ff]">
                        问题 {questionIndex + 1}
                      </div>
                      <h2 className="mt-1.5 text-[20px] font-semibold tracking-[-0.02em] text-[#17243a]">
                        {question.label}
                      </h2>
                      {question.reason && (
                        <p className="mt-2 text-[12px] leading-5 text-[#8998ac]">
                          推荐依据：{question.reason}
                        </p>
                      )}
                      <div className="mt-5 grid gap-2.5 md:grid-cols-2">
                        {question.options.map((option, index) => {
                          const active = question.value === option && !customIds.includes(question.id);
                          return (
                            <button
                              key={option}
                              type="button"
                              onClick={() => setQuestionValue(question, option)}
                              className={cx(
                                "requirement-option",
                                active && "requirement-option-active",
                              )}
                            >
                              <span className="w-5 shrink-0 font-semibold opacity-75">
                                {String.fromCharCode(65 + index)}
                              </span>
                              <span className="truncate">{option}</span>
                              {active && <Icon name="check" size={16} />}
                            </button>
                          );
                        })}
                        <button
                          type="button"
                          onClick={() => setQuestionValue(question, "", true)}
                          className={cx(
                            "requirement-option",
                            customIds.includes(question.id) && "requirement-option-active",
                          )}
                        >
                          <span className="w-5 shrink-0 font-semibold opacity-75">
                            {String.fromCharCode(65 + question.options.length)}
                          </span>
                          <span>自定义</span>
                        </button>
                      </div>
                      {customIds.includes(question.id) && (
                        <input
                          autoFocus
                          value={question.value}
                          onChange={(event) => setQuestionValue(question, event.target.value, true)}
                          placeholder="输入你的答案"
                          className="form-field mt-3"
                        />
                      )}
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between border-t border-[#edf1f7] px-5 py-4">
                  <div className="flex gap-2">
                    <button
                      className="ui-icon-button"
                      disabled={questionIndex === 0}
                      onClick={() => setQuestionIndex((current) => Math.max(0, current - 1))}
                      aria-label="上一题"
                    >
                      <Icon name="back" size={16} />
                    </button>
                    <button
                      className="ui-icon-button"
                      disabled={questionIndex === draft.questions.length - 1}
                      onClick={() =>
                        setQuestionIndex((current) =>
                          Math.min(draft.questions.length - 1, current + 1),
                        )
                      }
                      aria-label="下一题"
                    >
                      <Icon name="arrow" size={16} />
                    </button>
                  </div>
                  {questionIndex === draft.questions.length - 1 ? (
                    <button
                      disabled={!allAnswered || submitting}
                      onClick={() => void submit()}
                      className="primary-button"
                    >
                      {submitting ? "正在生成结构板…" : "提交需求单"}
                      {!submitting && <Icon name="arrow" size={15} />}
                    </button>
                  ) : (
                    <button
                      disabled={!question?.value.trim()}
                      onClick={() => setQuestionIndex((current) => current + 1)}
                      className="primary-button"
                    >
                      下一题
                      <Icon name="arrow" size={15} />
                    </button>
                  )}
                </div>
              </section>
            </>
          )}
          {(error || project.errorText) && (
            <div className="rounded-[14px] border border-red-200 bg-red-50 px-4 py-3 text-[12px] text-red-700">
              {error || project.errorText}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function ResearchLoading({ project, onResume }: { project: ProjectDTO; onResume: () => void }) {
  const failed = project.status === "failed";
  const paused = project.status === "paused" && !project.requirementsReady;
  return (
    <div className="rounded-[22px] border border-[#e4ebf5] bg-white p-5 shadow-[0_14px_40px_rgba(30,64,110,0.07)]">
      <div className="flex items-center gap-3">
        <span className={cx("research-pulse", (failed || paused) && "bg-amber-400")} />
        <div>
          <div className="text-[14px] font-semibold">
            {failed ? "调研流程遇到问题" : paused ? "调研已暂停" : "Agent 正在建立主题背景"}
          </div>
          <div className="mt-1 text-[12px] text-[#8292a7]">
            {project.events.at(-1)?.title || "规划检索词并筛选可靠来源"}
          </div>
        </div>
      </div>
      <div className="mt-5 grid grid-cols-3 gap-2">
        {[0, 1, 2].map((index) => (
          <div key={index} className="h-2 overflow-hidden rounded-full bg-[#edf2f8]">
            <div
              className="h-full rounded-full bg-[#4c91ff] transition-all"
              style={{ width: index === 0 ? "100%" : index === 1 ? "64%" : "22%" }}
            />
          </div>
        ))}
      </div>
      {(failed || paused) && (
        <button onClick={onResume} className="secondary-button mt-5">
          继续调研
        </button>
      )}
    </div>
  );
}

function ResearchReceipt({ project }: { project: ProjectDTO }) {
  return (
    <div className="animate-rise overflow-hidden rounded-[18px] border border-[#dbe8fb] bg-[#f3f8ff]">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2 text-[13px] font-semibold text-[#255fba]">
          <span className="grid h-6 w-6 place-items-center rounded-full bg-[#2f80ff] text-white">
            <Icon name="check" size={14} />
          </span>
          背景调研完成
        </div>
        <span className="rounded-full bg-white px-2 py-1 text-[10px] font-semibold text-[#2f80ff]">
          {project.researchSources.length} 条资料
        </span>
      </div>
      <div className="border-t border-[#dbe8fb] bg-white/70 px-4 py-2.5">
        {project.researchSources.slice(0, 2).map((source) => (
          <a
            key={source.url}
            href={source.url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 py-1.5 text-[11px] text-[#6f8097] hover:text-[#2f80ff]"
          >
            <Icon name="search" size={13} />
            <span className="truncate">{source.title}</span>
          </a>
        ))}
      </div>
    </div>
  );
}

function TimelineLine({
  complete,
  active,
  label,
}: {
  complete: boolean;
  active: boolean;
  label: string;
}) {
  return (
    <div className="flex items-center gap-3 text-[14px] text-[#7c90a9]">
      <span
        className={cx(
          "grid h-8 w-8 shrink-0 place-items-center rounded-full",
          complete ? "bg-[#e8f2ff] text-[#2f80ff]" : "bg-[#eef2f7] text-[#98a6b8]",
        )}
      >
        {complete ? <Icon name="check" size={16} /> : <span className={cx(active && "research-pulse")} />}
      </span>
      <span>{label}</span>
    </div>
  );
}

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}
