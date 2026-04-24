import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { createDb } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DB_PATH ?? path.join(__dirname, '..', 'data', 'expenses.db');
const port = Number(process.env.PORT ?? 3001);
const frontendDir = process.env.FRONTEND_DIST ?? path.join(__dirname, '..', '..', 'dist');
const hasFrontendBundle = fs.existsSync(path.join(frontendDir, 'index.html'));

const db = createDb(dbPath);
const app = createApp(db, { frontendDir: hasFrontendBundle ? frontendDir : null });

const server = app.listen(port, () => {
  console.log(`Expense Tracker API listening on http://localhost:${port}`);
  console.log(`SQLite file: ${dbPath}`);
  console.log(
    hasFrontendBundle
      ? `Serving frontend bundle from: ${frontendDir}`
      : 'Frontend bundle not found; running in API-only mode',
  );
});

// Graceful shutdown so WAL checkpoints flush and we don't leave a half-open
// socket behind in dev after `node --watch` restarts.
function shutdown(signal) {
  console.log(`\nReceived ${signal}, shutting down...`);
  server.close(() => {
    db.close();
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
