"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { AppSettings, LlmProtocol } from "@/lib/types";

const PROTOCOLS: { id: LlmProtocol; label: string; hint: string }[] = [
  { id: "responses", label: "OpenAI Responses", hint: "/v1/responses" },
  { id: "messages", label: "Messages", hint: "/v1/messages" },
  { id: "gemini", label: "Gemini", hint: "/v1beta/models" },
  { id: "chat_completions", label: "Chat Completions", hint: "/v1/chat/completions" },
];

const emptySettings: AppSettings = {
  text: { baseUrl: "", apiKey: "", protocol: "chat_completions", model: "" },
  svg: { baseUrl: "", apiKey: "", protocol: "chat_completions", model: "" },
  search: { baseUrl: "", apiKey: "", protocol: "chat_completions", model: "" },
};

export default function SettingsScreen() {
  const router = useRouter();
  const [settings, setSettings] = useState<AppSettings>(emptySettings);
  const [textModels, setTextModels] = useState<string[]>([]);
  const [svgModels, setSvgModels] = useState<string[]>([]);
  const [searchModels, setSearchModels] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void fetch("/api/settings")
      .then((res) => res.json())
      .then((data) => {
        if (data.settings) setSettings(data.settings);
      });
  }, []);

  async function pull(slot: "text" | "svg" | "search") {
    setMessage("");
    const config = settings[slot];
    const response = await fetch("/api/settings/models", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        protocol: config.protocol,
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      setMessage(data.error || "拉取失败");
      return;
    }
    if (slot === "text") setTextModels(data.models ?? []);
    else if (slot === "svg") setSvgModels(data.models ?? []);
    else setSearchModels(data.models ?? []);
    setMessage(`拉到 ${(data.models ?? []).length} 个模型`);
  }

  async function save() {
    setBusy(true);
    setMessage("");
    const response = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) {
      setMessage(data.error || "保存失败");
      return;
    }
    setSettings(data.settings);
    router.push("/");
  }

  return (
    <div className="min-h-dvh bg-[#f6f7f8] text-[#1d1d1f]">
      <div className="mx-auto max-w-[880px] px-5 py-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <button className="text-[13px] text-black/40" onClick={() => router.push("/")}>
              ← 返回
            </button>
            <h1 className="mt-2 text-[28px] font-semibold">模型与搜索</h1>
            <p className="mt-1 text-[13px] text-[#6e6e73]">
              文本、SVG、搜索各自独立配置。填完地址就能拉模型，Key 只存在本机。
            </p>
          </div>
          <button
            onClick={() => void save()}
            disabled={busy}
            className="rounded-full bg-[#0b84ff] px-5 py-2 text-[13px] font-medium text-white"
          >
            保存
          </button>
        </div>

        <ModelCard
          title="文本模型"
          hint="调研、假设、大纲、页摘要、改稿"
          value={settings.text}
          models={textModels}
          onChange={(text) => setSettings({ ...settings, text })}
          onPull={() => void pull("text")}
        />
        <ModelCard
          title="SVG 模型"
          hint="策划稿和设计稿出图"
          value={settings.svg}
          models={svgModels}
          onChange={(svg) => setSettings({ ...settings, svg })}
          onPull={() => void pull("svg")}
        />
        <ModelCard
          title="搜索模型"
          hint="背景调研与逐页资料检索；请选择具备联网能力的模型"
          value={settings.search}
          models={searchModels}
          onChange={(search) => setSettings({ ...settings, search })}
          onPull={() => void pull("search")}
          notice={
            /grok/i.test(settings.search.model) && settings.search.protocol !== "responses"
              ? "Grok 联网搜索必须选择 OpenAI Responses 协议"
              : undefined
          }
        />

        {message && <p className="mt-4 text-[13px] text-[#0b84ff]">{message}</p>}
      </div>
    </div>
  );
}

function ModelCard({
  title,
  hint,
  value,
  models,
  onChange,
  onPull,
  notice,
}: {
  title: string;
  hint: string;
  value: AppSettings["text"];
  models: string[];
  onChange: (value: AppSettings["text"]) => void;
  onPull: () => void;
  notice?: string;
}) {
  return (
    <section className="mb-4 rounded-[20px] border border-[#e5e5e5] bg-white p-5">
      <h2 className="text-[16px] font-semibold">{title}</h2>
      <p className="mt-1 text-[12px] text-[#6e6e73]">{hint}</p>
      {notice && (
        <p className="mt-2 rounded-[10px] bg-[#fff4e5] px-3 py-2 text-[12px] text-[#9a5b00]">
          {notice}
        </p>
      )}
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <Field
          label="Base URL"
          value={value.baseUrl}
          placeholder="https://api.openai.com/v1"
          onChange={(baseUrl) => onChange({ ...value, baseUrl })}
        />
        <Field
          label="API Key"
          value={value.apiKey}
          type="password"
          onChange={(apiKey) => onChange({ ...value, apiKey })}
        />
        <label className="block text-[12px] text-[#6e6e73]">
          协议
          <select
            className="mt-1 w-full rounded-[12px] border border-[#e5e5e5] bg-[#fafafa] px-3 py-2 text-[14px] text-[#1d1d1f]"
            value={value.protocol}
            onChange={(event) =>
              onChange({ ...value, protocol: event.target.value as LlmProtocol })
            }
          >
            {PROTOCOLS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label} · {item.hint}
              </option>
            ))}
          </select>
        </label>
        <div>
          <div className="mb-1 flex items-center justify-between text-[12px] text-[#6e6e73]">
            <span>模型</span>
            <button className="text-[#0b84ff]" onClick={onPull} type="button">
              拉取模型
            </button>
          </div>
          {models.length > 0 && (
            <select
              className="mb-2 w-full rounded-[12px] border border-[#e5e5e5] bg-[#fafafa] px-3 py-2 text-[14px]"
              value={value.model}
              onChange={(event) => onChange({ ...value, model: event.target.value })}
            >
              <option value="">选择模型</option>
              {models.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
          )}
          <input
            className="w-full rounded-[12px] border border-[#e5e5e5] bg-[#fafafa] px-3 py-2 text-[14px]"
            placeholder="或手填模型名"
            value={value.model}
            onChange={(event) => onChange({ ...value, model: event.target.value })}
          />
        </div>
      </div>
    </section>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: "text" | "password";
}) {
  return (
    <label className="block text-[12px] text-[#6e6e73]">
      {label}
      <input
        className="mt-1 w-full rounded-[12px] border border-[#e5e5e5] bg-[#fafafa] px-3 py-2 text-[14px] text-[#1d1d1f]"
        type={type}
        autoComplete={type === "password" ? "off" : undefined}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
