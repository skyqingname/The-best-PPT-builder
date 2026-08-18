import { getDb } from "./db";
import type { AppSettings, LlmProtocol, ModelConfig, SearchProvider } from "./types";

interface SettingsRow {
  text_base_url: string;
  text_api_key: string;
  text_protocol: string;
  text_model: string;
  svg_base_url: string;
  svg_api_key: string;
  svg_protocol: string;
  svg_model: string;
  search_provider: string;
  search_api_key: string;
}

function rowToSettings(row: SettingsRow): AppSettings {
  return {
    text: {
      baseUrl: row.text_base_url,
      apiKey: row.text_api_key,
      protocol: row.text_protocol as LlmProtocol,
      model: row.text_model,
    },
    svg: {
      baseUrl: row.svg_base_url,
      apiKey: row.svg_api_key,
      protocol: row.svg_protocol as LlmProtocol,
      model: row.svg_model,
    },
    searchProvider: row.search_provider as SearchProvider,
    searchApiKey: row.search_api_key,
  };
}

export function getSettings(): AppSettings {
  const row = getDb()
    .prepare("SELECT * FROM settings WHERE id = 1")
    .get() as SettingsRow;
  return rowToSettings(row);
}

export function saveSettings(settings: AppSettings): AppSettings {
  getDb()
    .prepare(
      `UPDATE settings SET
        text_base_url = @text_base_url,
        text_api_key = @text_api_key,
        text_protocol = @text_protocol,
        text_model = @text_model,
        svg_base_url = @svg_base_url,
        svg_api_key = @svg_api_key,
        svg_protocol = @svg_protocol,
        svg_model = @svg_model,
        search_provider = @search_provider,
        search_api_key = @search_api_key
      WHERE id = 1`,
    )
    .run({
      text_base_url: settings.text.baseUrl.trim(),
      text_api_key: settings.text.apiKey.trim(),
      text_protocol: settings.text.protocol,
      text_model: settings.text.model.trim(),
      svg_base_url: settings.svg.baseUrl.trim(),
      svg_api_key: settings.svg.apiKey.trim(),
      svg_protocol: settings.svg.protocol,
      svg_model: settings.svg.model.trim(),
      search_provider: settings.searchProvider,
      search_api_key: settings.searchApiKey.trim(),
    });
  return getSettings();
}

export function requireTextConfig(): ModelConfig {
  const settings = getSettings();
  if (!settings.text.baseUrl || !settings.text.apiKey || !settings.text.model) {
    throw new Error("先在设置里配好文本模型");
  }
  return settings.text;
}

export function requireSvgConfig(): ModelConfig {
  const settings = getSettings();
  if (!settings.svg.baseUrl || !settings.svg.apiKey || !settings.svg.model) {
    throw new Error("先在设置里配好 SVG 模型");
  }
  return settings.svg;
}

export function requireSearch(): { provider: SearchProvider; apiKey: string } {
  const settings = getSettings();
  if (!settings.searchApiKey) {
    throw new Error("先在设置里填写搜索 API Key");
  }
  return { provider: settings.searchProvider, apiKey: settings.searchApiKey };
}
