// The dashboard's own records, in one SQLite file under DATA_DIR. Mail itself
// lives in Stalwart; this keeps what Stalwart has no place for: the logins, the
// companies as the dashboard shows them, each address's folder, auto-reply and
// AI mode, the rules, the AI providers and company profiles, the AI log.
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config } from "./config.ts";

fs.mkdirSync(config.dataDir, { recursive: true });
export const db = new DatabaseSync(path.join(config.dataDir, "xooteq-mail.db"));
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");

// Each migration runs once, in order; add new ones at the end, never edit old ones.
const migrations: string[] = [
  `CREATE TABLE owners (
     id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL DEFAULT '',
     pw_hash TEXT NOT NULL, created_at INTEGER NOT NULL);
   CREATE TABLE sessions (
     token_hash TEXT PRIMARY KEY, owner_id INTEGER NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
     created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, last_seen INTEGER NOT NULL,
     ip TEXT, agent TEXT);
   CREATE TABLE companies (
     id TEXT PRIMARY KEY, name TEXT NOT NULL, domain TEXT NOT NULL UNIQUE, local TEXT NOT NULL,
     account_id TEXT NOT NULL, color TEXT NOT NULL, signature TEXT NOT NULL DEFAULT '',
     position INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
   CREATE TABLE addresses (
     id INTEGER PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
     local TEXT NOT NULL, label TEXT NOT NULL, is_primary INTEGER NOT NULL DEFAULT 0,
     auto_reply TEXT, ai_mode TEXT NOT NULL DEFAULT 'off', created_at INTEGER NOT NULL,
     UNIQUE(company_id, local));
   CREATE TABLE rules (
     id INTEGER PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
     name TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, match TEXT NOT NULL DEFAULT 'all',
     conditions TEXT NOT NULL, actions TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0,
     created_at INTEGER NOT NULL);
   CREATE TABLE ai_providers (
     id INTEGER PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, base_url TEXT,
     model TEXT NOT NULL, key_enc TEXT NOT NULL, created_at INTEGER NOT NULL);
   CREATE TABLE ai_profiles (
     company_id TEXT PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
     provider_id INTEGER REFERENCES ai_providers(id) ON DELETE SET NULL, profile TEXT NOT NULL);
   CREATE TABLE ai_runs (
     id INTEGER PRIMARY KEY, company_id TEXT NOT NULL, address TEXT, message_id TEXT,
     email_id TEXT, thread_id TEXT, sender TEXT, subject TEXT, mode TEXT, status TEXT NOT NULL,
     reason TEXT, draft_id TEXT, created_at INTEGER NOT NULL);
   CREATE INDEX ai_runs_company ON ai_runs(company_id, created_at);
   CREATE UNIQUE INDEX ai_runs_once ON ai_runs(company_id, message_id) WHERE message_id IS NOT NULL;`,
  // AI replies in send mode wait here (status 'scheduled') until send_at, so they can be stopped.
  `ALTER TABLE ai_runs ADD COLUMN send_at INTEGER;
   CREATE INDEX ai_runs_due ON ai_runs(status, send_at);`,
];

db.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)");
const done = Number((db.prepare("SELECT value FROM meta WHERE key = 'schema'").get() as { value?: string } | undefined)?.value ?? 0);
for (let i = done; i < migrations.length; i++) {
  db.exec("BEGIN");
  try {
    db.exec(migrations[i]);
    db.prepare("INSERT INTO meta (key, value) VALUES ('schema', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(i + 1));
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export const now = () => Date.now();

/** Runs fn in a transaction. */
export function tx<T>(fn: () => T): T {
  db.exec("BEGIN");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export function json<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
}
