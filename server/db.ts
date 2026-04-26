import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import * as schema from "@shared/schema";
import path from "path";
import fs from "fs";

// DB_PATH aus .env, default: ./data/data.db (zentraler Datenordner)
const dbPath = path.resolve(
  process.cwd(),
  process.env.DB_PATH ?? "data/data.db"
);

// Sicherstellen dass der Ordner existiert
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const sqlite = new Database(dbPath);

// Enable WAL mode for better concurrent read performance
sqlite.pragma("journal_mode = WAL");

export const db = drizzle(sqlite, { schema });
export const rawDb = sqlite;

// Run migrations inline (simple CREATE TABLE IF NOT EXISTS)
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS cached_documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    gesetzesnummer TEXT NOT NULL,
    dokumentnummer TEXT NOT NULL UNIQUE,
    abkuerzung TEXT,
    kurztitel TEXT,
    artikel_paragraph_anlage TEXT,
    inhalt TEXT,
    abschnitt TEXT,
    inkrafttretedatum TEXT,
    dokument_url TEXT,
    cached_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_cached_docs_gesetz ON cached_documents(gesetzesnummer);

  CREATE TABLE IF NOT EXISTS law_index (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    gesetzesnummer TEXT NOT NULL UNIQUE,
    abkuerzung TEXT NOT NULL,
    title TEXT NOT NULL,
    total_docs INTEGER DEFAULT 0,
    cached_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS bookmarks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dokumentnummer TEXT NOT NULL,
    gesetzesnummer TEXT NOT NULL,
    abkuerzung TEXT NOT NULL,
    artikel_paragraph_anlage TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS user_collections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    collection_id TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    color TEXT NOT NULL DEFAULT 'blue',
    icon TEXT NOT NULL DEFAULT 'BookOpen',
    is_builtin INTEGER NOT NULL DEFAULT 0,
    sort_index INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS user_laws (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    law_id TEXT NOT NULL UNIQUE,
    collection_id TEXT NOT NULL,
    gesetzesnummer TEXT NOT NULL UNIQUE,
    abkuerzung TEXT NOT NULL,
    title TEXT NOT NULL,
    short_description TEXT DEFAULT '',
    is_builtin INTEGER NOT NULL DEFAULT 0,
    auto_update INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dokumentnummer TEXT NOT NULL,
    gesetzesnummer TEXT NOT NULL,
    abkuerzung TEXT NOT NULL,
    artikel_paragraph_anlage TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS law_order (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    collection_id TEXT NOT NULL,
    law_id TEXT NOT NULL,
    sort_index INTEGER NOT NULL,
    UNIQUE(collection_id, law_id)
  );

  CREATE INDEX IF NOT EXISTS idx_law_order_collection ON law_order(collection_id);
`);

// ─── ALTER-Migrationen (additive Spalten, idempotent) ───────────────────────
function addColumnIfMissing(table: string, column: string, ddl: string) {
  const cols = sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) {
    sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl};`);
  }
}
addColumnIfMissing("user_collections", "is_builtin", "is_builtin INTEGER NOT NULL DEFAULT 0");
addColumnIfMissing("user_collections", "sort_index", "sort_index INTEGER NOT NULL DEFAULT 0");
addColumnIfMissing("user_laws", "is_builtin", "is_builtin INTEGER NOT NULL DEFAULT 0");
addColumnIfMissing("user_laws", "auto_update", "auto_update INTEGER NOT NULL DEFAULT 1");

// ─── Highlights-Tabelle ─────────────────────────────────────────────────────
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS highlights (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dokumentnummer TEXT NOT NULL UNIQUE,
    html_content TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
`);
