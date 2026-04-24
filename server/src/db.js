import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

// `node:sqlite` landed in Node 22.5; Vitest's Vite-based transform has a
// hardcoded builtins list that predates it and errors on the static import.
// Loading via createRequire hides the import from Vite's static analysis and
// delegates to Node's own loader, which knows about the builtin.
const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire('node:sqlite');

// We use SQLite (via Node 22.5+'s built-in `node:sqlite`) because the data
// fits a single file, the workload is tiny, and it gives us real ACID
// transactions (which we rely on for idempotency). Using the built-in driver
// instead of better-sqlite3 avoids a native-build dependency on the
// reviewer's machine. For a larger deployment the same schema ports to
// Postgres with minor changes (BIGSERIAL, TIMESTAMPTZ).

export function createDb(filename) {
  if (filename !== ':memory:') {
    fs.mkdirSync(path.dirname(filename), { recursive: true });
  }
  const db = new DatabaseSync(filename);
  // WAL gives us concurrent readers alongside a single writer, and tolerates
  // sudden process death better than the default rollback journal.
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db);
  return db;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS expenses (
      id           TEXT PRIMARY KEY,
      -- amount stored as integer MINOR units (paise). Never floats.
      amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
      category     TEXT NOT NULL,
      description  TEXT NOT NULL DEFAULT '',
      -- ISO-8601 date (YYYY-MM-DD), day precision.
      date         TEXT NOT NULL,
      -- server-assigned creation time in ISO-8601 UTC.
      created_at   TEXT NOT NULL
    );

    -- Index tuned for the two query shapes we serve: "all expenses sorted
    -- newest first" and "filter by category, sorted newest first". created_at
    -- is the tiebreaker so two expenses on the same day keep a stable order.
    CREATE INDEX IF NOT EXISTS idx_expenses_date_created
      ON expenses (date DESC, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_expenses_category_date
      ON expenses (category, date DESC, created_at DESC);

    -- Idempotency cache: if a client retries POST /expenses with the same
    -- Idempotency-Key we return the ORIGINAL response body verbatim, even if
    -- the caller changed the request body between retries (that's a client
    -- bug — surfacing it as a conflict would confuse well-behaved clients
    -- that hit the same endpoint twice due to a browser refresh).
    CREATE TABLE IF NOT EXISTS idempotency_keys (
      key           TEXT PRIMARY KEY,
      expense_id    TEXT NOT NULL,
      response_json TEXT NOT NULL,
      created_at    TEXT NOT NULL,
      FOREIGN KEY (expense_id) REFERENCES expenses(id) ON DELETE CASCADE
    );
  `);
}
