import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

export const db = new DatabaseSync(config.dbPath);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA busy_timeout = 5000;');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'free',
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS youtube_connections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  google_user_id TEXT,
  channel_id TEXT,
  channel_title TEXT,
  channel_thumbnail TEXT,
  subscriber_count INTEGER,
  access_token_enc TEXT,
  refresh_token_enc TEXT,
  token_expires_at TEXT,
  scopes TEXT,
  state TEXT NOT NULL DEFAULT 'OFFLINE',
  live_video_id TEXT,
  live_chat_id TEXT,
  live_title TEXT,
  last_live_check TEXT,
  last_event_poll TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_conn_user ON youtube_connections(user_id);
CREATE INDEX IF NOT EXISTS idx_conn_channel ON youtube_connections(channel_id);

CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  event_type TEXT NOT NULL,
  category TEXT,
  style TEXT,
  orientation TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  configuration TEXT NOT NULL,
  is_system INTEGER NOT NULL DEFAULT 1,
  is_premium INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_templates_event ON templates(event_type);

CREATE TABLE IF NOT EXISTS user_templates (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  source_template_id TEXT,
  name TEXT NOT NULL,
  event_type TEXT NOT NULL,
  configuration TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ut_user ON user_templates(user_id);

CREATE TABLE IF NOT EXISTS overlays (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  token TEXT UNIQUE NOT NULL,
  width INTEGER NOT NULL DEFAULT 1920,
  height INTEGER NOT NULL DEFAULT 1080,
  orientation TEXT NOT NULL DEFAULT '16:9',
  settings TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_overlays_user ON overlays(user_id);
CREATE INDEX IF NOT EXISTS idx_overlays_token ON overlays(token);

CREATE TABLE IF NOT EXISTS alert_assignments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  overlay_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  user_template_id TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 1,
  conditions TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_assign_user ON alert_assignments(user_id);
CREATE INDEX IF NOT EXISTS idx_assign_overlay ON alert_assignments(overlay_id);

CREATE TABLE IF NOT EXISTS media (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime TEXT,
  size INTEGER,
  path TEXT NOT NULL,
  url TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_media_user ON media(user_id);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  overlay_id TEXT,
  connection_id TEXT,
  event_type TEXT NOT NULL,
  username TEXT,
  amount REAL,
  currency TEXT,
  message TEXT,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_events_user ON events(user_id);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);

CREATE TABLE IF NOT EXISTS favorites (
  user_id TEXT NOT NULL,
  template_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, template_id)
);

CREATE TABLE IF NOT EXISTS template_usage (
  user_id TEXT NOT NULL,
  template_id TEXT NOT NULL,
  used_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_usage_user ON template_usage(user_id);

CREATE TABLE IF NOT EXISTS milestones (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  threshold INTEGER NOT NULL,
  user_template_id TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_milestones_user ON milestones(user_id);

CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);
`;

export function migrate() {
  db.exec(SCHEMA);
}

// --- query helpers ---------------------------------------------------------

export function get(sql, ...params) {
  return db.prepare(sql).get(...params);
}

export function all(sql, ...params) {
  return db.prepare(sql).all(...params);
}

export function run(sql, ...params) {
  return db.prepare(sql).run(...params);
}

export function rowToJson(row) {
  if (!row) return row;
  const out = { ...row };
  for (const k of Object.keys(out)) {
    if (out[k] instanceof Uint8Array) out[k] = Buffer.from(out[k]).toString('utf8');
  }
  return out;
}
