-- ============================================================================
-- Adeptio Project Tracking — Cloudflare D1 schema
-- Apply once:  npx wrangler d1 execute adeptio-gantt --remote --file=./schema.sql
-- ============================================================================

-- Live application state: one row per workspace. `doc` is the whole app DB
-- (the same { projects:[...] } JSON the browser keeps in localStorage).
CREATE TABLE IF NOT EXISTS app_state (
  id          TEXT PRIMARY KEY,            -- workspace key (default: 'default')
  doc         TEXT NOT NULL,               -- full app DB as JSON
  rev         INTEGER NOT NULL DEFAULT 1,  -- server-incremented version (last-write-wins)
  updated_at  TEXT NOT NULL                -- ISO timestamp of last write
);

-- Rolling snapshot history (manual "Back up now" + scheduled daily/weekly).
-- Pruned to the most recent 30 per workspace by the Worker.
CREATE TABLE IF NOT EXISTS backups (
  id      TEXT PRIMARY KEY,                -- e.g. default-20260621183000-daily
  ws      TEXT NOT NULL,                   -- workspace key
  ts      TEXT NOT NULL,                   -- ISO timestamp
  period  TEXT NOT NULL,                   -- 'manual' | 'daily' | 'weekly'
  doc     TEXT NOT NULL                    -- snapshot of the app DB JSON
);
CREATE INDEX IF NOT EXISTS idx_backups_ws_ts ON backups(ws, ts DESC);
