"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  FileText,
  KeyRound,
  Palette,
  RefreshCw,
  Save,
  Search,
  type LucideIcon,
} from "lucide-react";
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
    <div className="settings-shell min-h-dvh text-[#17243a]">
      <form
        className="mx-auto max-w-[1060px] px-5 py-8 md:py-12"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="settings-hero mb-9 flex items-end justify-between">
          <div>
            <button type="button" className="settings-back" onClick={() => router.push("/")}>
              <ArrowLeft size={15} />
              返回工作台
            </button>
            <div className="mt-8 text-[10px] font-semibold tracking-[0.22em] text-[#2f80ff]">SYSTEM CONFIGURATION</div>
            <h1 className="mt-2 text-[clamp(36px,5vw,62px)] leading-none font-semibold tracking-[-0.055em]">模型控制台</h1>
            <p className="mt-4 max-w-[620px] text-[13px] leading-6 text-[#718096]">
              文本、SVG、搜索各自独立配置。填完地址就能拉模型，Key 只存在本机。
            </p>
          </div>
          <button
            type="submit"
            disabled={busy}
            className="settings-save"
          >
            <Save size={15} />
            <span className="settings-save-label">{busy ? "保存中" : "保存配置"}</span>
          </button>
        </div>

        <div className="grid gap-4">
          <ModelCard
            index="01"
            icon={FileText}
            title="文本模型"
            hint="需求分析、大纲、意图解析与内容决策"
            value={settings.text}
            models={textModels}
            onChange={(text) => setSettings({ ...settings, text })}
            onPull={() => void pull("text")}
          />
          <ModelCard
            index="02"
            icon={Palette}
            title="SVG 模型"
            hint="1280 × 720 初稿编排与视觉设计"
            value={settings.svg}
            models={svgModels}
            onChange={(svg) => setSettings({ ...settings, svg })}
            onPull={() => void pull("svg")}
          />
          <ModelCard
            index="03"
            icon={Search}
            title="搜索模型"
            hint="项目背景与内容页公开资料检索"
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
        </div>

        {message && <p className="settings-message">{message}</p>}
      </form>
    </div>
  );
}

function ModelCard({
  index,
  icon: Glyph,
  title,
  hint,
  value,
  models,
  onChange,
  onPull,
  notice,
}: {
  index: string;
  icon: LucideIcon;
  title: string;
  hint: string;
  value: AppSettings["text"];
  models: string[];
  onChange: (value: AppSettings["text"]) => void;
  onPull: () => void;
  notice?: string;
}) {
  return (
    <section className="settings-card">
      <div className="settings-card-heading">
        <div className="settings-card-index">{index}</div>
        <div className="settings-card-icon"><Glyph size={18} /></div>
        <div>
          <h2 className="text-[17px] font-semibold tracking-[-0.02em]">{title}</h2>
          <p className="mt-1 text-[11px] text-[#7a889c]">{hint}</p>
        </div>
      </div>
      {notice && (
        <p className="mt-2 rounded-[10px] bg-[#fff4e5] px-3 py-2 text-[12px] text-[#9a5b00]">
          {notice}
        </p>
      )}
      <div className="mt-6 grid gap-4 md:grid-cols-2">
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
        <label className="settings-field">
          协议
          <select
            className="settings-input"
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
          <div className="mb-2 flex items-center justify-between text-[11px] font-medium text-[#66758a]">
            <span>模型</span>
            <button className="flex items-center gap-1.5 text-[#2f80ff]" onClick={onPull} type="button">
              <RefreshCw size={12} />
              拉取模型
            </button>
          </div>
          {models.length > 0 && (
            <select
              className="settings-input mb-2"
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
            className="settings-input"
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
    <label className="settings-field">
      <span className="flex items-center gap-1.5">{type === "password" && <KeyRound size={12} />}{label}</span>
      <input
        className="settings-input"
        type={type}
        autoComplete={type === "password" ? "off" : undefined}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
