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

const SEARCH_PROVIDERS: {
  id: "tavily" | "bocha";
  label: string;
  homeUrl: string;
  homeLabel: string;
}[] = [
  {
    id: "tavily",
    label: "Tavily",
    homeUrl: "https://app.tavily.com/home",
    homeLabel: "打开 Tavily 控制台",
  },
  {
    id: "bocha",
    label: "博查",
    homeUrl: "https://open.bochaai.com/",
    homeLabel: "打开博查开放平台",
  },
];

const emptySettings: AppSettings = {
  text: { baseUrl: "", apiKey: "", protocol: "chat_completions", model: "" },
  svg: { baseUrl: "", apiKey: "", protocol: "chat_completions", model: "" },
  searchProvider: "tavily",
  searchApiKey: "",
};

export default function SettingsScreen() {
  const router = useRouter();
  const [settings, setSettings] = useState<AppSettings>(emptySettings);
  const [textModels, setTextModels] = useState<string[]>([]);
  const [svgModels, setSvgModels] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void fetch("/api/settings")
      .then((res) => res.json())
      .then((data) => {
        if (data.settings) setSettings(data.settings);
      });
  }, []);

  async function pull(slot: "text" | "svg") {
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
    else setSvgModels(data.models ?? []);
    setMessage(`拉到 ${(data.models ?? []).length} 个模型`);
  }

  const currentSearch = SEARCH_PROVIDERS.find((item) => item.id === settings.searchProvider);

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
              文本和 SVG 各用一把 Key。填完地址就能拉模型。Key 只存在本机。
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

        <section className="mt-4 rounded-[20px] border border-[#e5e5e5] bg-white p-5">
          <h2 className="text-[16px] font-semibold">搜索</h2>
          <p className="mt-1 text-[12px] text-[#6e6e73]">只用一把 Key。先做 Tavily 和博查。</p>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <div>
              <div className="mb-1 flex items-center justify-between text-[12px] text-[#6e6e73]">
                <span>供应商</span>
                {currentSearch && (
                  <a
                    href={currentSearch.homeUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[#0b84ff] hover:underline"
                  >
                    {currentSearch.homeLabel}
                  </a>
                )}
              </div>
              <select
                className="w-full rounded-[12px] border border-[#e5e5e5] bg-[#fafafa] px-3 py-2 text-[14px] text-[#1d1d1f]"
                value={settings.searchProvider}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    searchProvider: event.target.value as "tavily" | "bocha",
                  })
                }
              >
                {SEARCH_PROVIDERS.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>
            <label className="block text-[12px] text-[#6e6e73]">
              API Key
              <input
                className="mt-1 w-full rounded-[12px] border border-[#e5e5e5] bg-[#fafafa] px-3 py-2 text-[14px]"
                value={settings.searchApiKey}
                onChange={(event) =>
                  setSettings({ ...settings, searchApiKey: event.target.value })
                }
              />
            </label>
          </div>
        </section>

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
}: {
  title: string;
  hint: string;
  value: AppSettings["text"];
  models: string[];
  onChange: (value: AppSettings["text"]) => void;
  onPull: () => void;
}) {
  return (
    <section className="mb-4 rounded-[20px] border border-[#e5e5e5] bg-white p-5">
      <h2 className="text-[16px] font-semibold">{title}</h2>
      <p className="mt-1 text-[12px] text-[#6e6e73]">{hint}</p>
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
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block text-[12px] text-[#6e6e73]">
      {label}
      <input
        className="mt-1 w-full rounded-[12px] border border-[#e5e5e5] bg-[#fafafa] px-3 py-2 text-[14px] text-[#1d1d1f]"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
