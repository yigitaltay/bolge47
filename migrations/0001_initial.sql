PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS rhythm_profiles (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  avatar_color TEXT NOT NULL DEFAULT '#9cff3b',
  total_score INTEGER NOT NULL DEFAULT 0,
  plays INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS rhythm_runs (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  track_id TEXT NOT NULL,
  difficulty TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  submitted_at INTEGER
);

CREATE TABLE IF NOT EXISTS rhythm_scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  track_id TEXT NOT NULL,
  difficulty TEXT NOT NULL,
  score INTEGER NOT NULL,
  accuracy REAL NOT NULL,
  max_combo INTEGER NOT NULL,
  perfect INTEGER NOT NULL,
  great INTEGER NOT NULL,
  good INTEGER NOT NULL,
  miss INTEGER NOT NULL,
  grade TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS rhythm_scores_board_idx ON rhythm_scores(track_id, difficulty, score DESC);
CREATE INDEX IF NOT EXISTS rhythm_scores_user_idx ON rhythm_scores(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS rhythm_runs_expiry_idx ON rhythm_runs(expires_at);
