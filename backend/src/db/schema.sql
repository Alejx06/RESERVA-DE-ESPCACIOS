CREATE TABLE IF NOT EXISTS spaces (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  name      TEXT    NOT NULL UNIQUE,
  type      TEXT    NOT NULL CHECK (type IN ('salon', 'laboratorio', 'sala')),
  capacity  INTEGER NOT NULL CHECK (capacity > 0),
  location  TEXT    NOT NULL DEFAULT '',
  active    INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  full_name     TEXT    NOT NULL,
  password_hash TEXT    NOT NULL,
  role          TEXT    NOT NULL CHECK (role IN ('Profesor', 'Estudiante', 'Administrativo')),
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT    NOT NULL,
  created_at TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS account_verifications (
  user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  code_hash  TEXT    NOT NULL,
  expires_at TEXT    NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS reservations (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  space_id         INTEGER NOT NULL REFERENCES spaces(id),
  user_id          INTEGER REFERENCES users(id),
  date             TEXT    NOT NULL,                       -- YYYY-MM-DD
  start_hour       INTEGER NOT NULL,                       -- inclusive (ej. 8 = 08:00)
  end_hour         INTEGER NOT NULL,                       -- exclusivo (ej. 10 = hasta las 10:00)
  responsible_name TEXT    NOT NULL,
  role             TEXT    NOT NULL CHECK (role IN ('Profesor', 'Estudiante', 'Administrativo')),
  purpose          TEXT    NOT NULL DEFAULT 'Sin especificar',
  status           TEXT    NOT NULL DEFAULT 'activa' CHECK (status IN ('activa', 'cancelada')),
  created_at       TEXT    NOT NULL,
  cancelled_at     TEXT,
  CHECK (end_hour > start_hour)
);

CREATE INDEX IF NOT EXISTS idx_reservations_lookup ON reservations (space_id, date, status);
CREATE INDEX IF NOT EXISTS idx_reservations_date   ON reservations (date, status);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry     ON sessions (expires_at);
