CREATE TABLE game (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  json TEXT NOT NULL
) STRICT;

CREATE TABLE clips (
  idx INTEGER PRIMARY KEY,
  start_ms INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  renditions TEXT NOT NULL,
  state TEXT NULL,
  state_confidence INTEGER NULL,
  classification TEXT NOT NULL
) STRICT;

CREATE TABLE answers (
  id INTEGER PRIMARY KEY,
  clip_idx INTEGER NOT NULL,
  pass INTEGER NOT NULL,
  window INTEGER NOT NULL,
  json TEXT NOT NULL,
  created_at INTEGER NOT NULL
) STRICT;

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  clip_idx INTEGER NOT NULL,
  video_ms INTEGER NOT NULL,
  status TEXT NOT NULL,
  needs_count INTEGER NOT NULL,
  json TEXT NOT NULL
) STRICT;

CREATE INDEX events_video_ms ON events (video_ms);
