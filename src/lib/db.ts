import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const dataDir = path.join(process.cwd(), "data");
const dbPath = path.join(dataDir, "ppt-agent.db");

let instance: Database.Database | null = null;

export function getDb(): Database.Database {
  if (instance) return instance;
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  instance = db;
  return db;
}

function migrate(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      text_base_url TEXT NOT NULL DEFAULT '',
      text_api_key TEXT NOT NULL DEFAULT '',
      text_protocol TEXT NOT NULL DEFAULT 'chat_completions',
      text_model TEXT NOT NULL DEFAULT '',
      svg_base_url TEXT NOT NULL DEFAULT '',
      svg_api_key TEXT NOT NULL DEFAULT '',
      svg_protocol TEXT NOT NULL DEFAULT 'chat_completions',
      svg_model TEXT NOT NULL DEFAULT '',
      search_provider TEXT NOT NULL DEFAULT 'tavily',
      search_api_key TEXT NOT NULL DEFAULT ''
    );

    INSERT OR IGNORE INTO settings (id) VALUES (1);

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      request_text TEXT NOT NULL,
      stage TEXT NOT NULL,
      status TEXT NOT NULL,
      page_count_target INTEGER NOT NULL DEFAULT 12,
      style_id TEXT NOT NULL DEFAULT 'brand-clean',
      assumptions_json TEXT NOT NULL DEFAULT '{}',
      outline_json TEXT NOT NULL DEFAULT '',
      init_sources_json TEXT NOT NULL DEFAULT '[]',
      error_text TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pages (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      page_code TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      page_type TEXT NOT NULL,
      section_title TEXT,
      title TEXT NOT NULL,
      bullets_json TEXT NOT NULL DEFAULT '[]',
      search_queries_json TEXT NOT NULL DEFAULT '[]',
      sources_json TEXT NOT NULL DEFAULT '[]',
      summary_md TEXT NOT NULL DEFAULT '',
      draft_svg TEXT NOT NULL DEFAULT '',
      design_svg TEXT NOT NULL DEFAULT '',
      speaker_notes TEXT NOT NULL DEFAULT '',
      search_status TEXT NOT NULL DEFAULT 'empty',
      summary_status TEXT NOT NULL DEFAULT 'empty',
      draft_status TEXT NOT NULL DEFAULT 'empty',
      design_status TEXT NOT NULL DEFAULT 'empty',
      needs_rerun INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      page_id TEXT,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_pages_project ON pages(project_id, sort_order);
    CREATE INDEX IF NOT EXISTS idx_events_project ON events(project_id, created_at);
  `);
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function newId(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${random}`;
}
