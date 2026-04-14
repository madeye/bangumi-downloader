import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

// SQLite-backed KV cache for search responses. Chosen over an in-memory Map
// because: (a) persistence across dev-server restarts means we don't hammer
// upstream providers every time we edit a file, and (b) it survives the
// Next.js module reload cycle that throws away in-memory state in dev.
//
// The schema is deliberately tiny — a single key→payload table with a Unix
// timestamp expiry. Callers serialize their own JSON.

const DEFAULT_DB_PATH = path.join(process.cwd(), ".cache", "search.sqlite");

let db: Database.Database | undefined;

function getDb(): Database.Database {
  if (db) return db;
  const dbPath = process.env.CACHE_DB_PATH || DEFAULT_DB_PATH;
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS search_cache (
      key TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_search_cache_expires
      ON search_cache(expires_at);
  `);
  return db;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export function cacheGet<T>(key: string): T | undefined {
  try {
    const row = getDb()
      .prepare("SELECT payload, expires_at FROM search_cache WHERE key = ?")
      .get(key) as { payload: string; expires_at: number } | undefined;
    if (!row) return undefined;
    if (row.expires_at <= nowSeconds()) {
      getDb().prepare("DELETE FROM search_cache WHERE key = ?").run(key);
      return undefined;
    }
    return JSON.parse(row.payload) as T;
  } catch {
    // Cache failures must never break search — fall through to a fresh fetch.
    return undefined;
  }
}

export function cacheSet<T>(key: string, value: T, ttlSeconds: number): void {
  try {
    const expiresAt = nowSeconds() + ttlSeconds;
    getDb()
      .prepare(
        `INSERT INTO search_cache (key, payload, expires_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           payload = excluded.payload,
           expires_at = excluded.expires_at`
      )
      .run(key, JSON.stringify(value), expiresAt);
    // Opportunistic pruning — keep the table from growing unbounded without
    // needing a separate scheduler.
    if (Math.random() < 0.02) {
      getDb()
        .prepare("DELETE FROM search_cache WHERE expires_at <= ?")
        .run(nowSeconds());
    }
  } catch {
    // Cache write failures are silent — a missed cache isn't a bug.
  }
}
