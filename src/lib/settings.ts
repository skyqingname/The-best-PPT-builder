import { getDb } from "./db";
import type { AppSettings, LlmProtocol, ModelConfig } from "./types";

interface SettingsRow {
  text_base_url: string;
  text_api_key: string;
  text_protocol: string;
  text_model: string;
  svg_base_url: string;
  svg_api_key: string;
  svg_protocol: string;
  svg_model: string;
  search_base_url: string;
  search_api_key: string;
  search_protocol: string;
  search_model: string;
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
    search: {
      baseUrl: row.search_base_url,
      apiKey: row.search_api_key,
      protocol: row.search_protocol as LlmProtocol,
      model: row.search_model,
    },
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
        search_base_url = @search_base_url,
        search_api_key = @search_api_key,
        search_protocol = @search_protocol,
        search_model = @search_model
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
      search_base_url: settings.search.baseUrl.trim(),
      search_api_key: settings.search.apiKey.trim(),
      search_protocol: settings.search.protocol,
      search_model: settings.search.model.trim(),
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

export function requireSearch(): ModelConfig {
  const settings = getSettings();
  if (!settings.search.baseUrl || !settings.search.apiKey || !settings.search.model) {
    throw new Error("先在设置里配好搜索模型");
  }
  return settings.search;
}

export function isAppConfigured(settings = getSettings()): boolean {
  return [settings.text, settings.svg, settings.search].every(
    (config) => Boolean(config.baseUrl.trim() && config.apiKey.trim() && config.model.trim()),
  );
}
