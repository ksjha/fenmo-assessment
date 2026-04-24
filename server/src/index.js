import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { createDb } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DB_PATH ?? path.join(__dirname, '..', 'data', 'expenses.db');
const port = Number(process.env.PORT ?? 3001);

const db = createDb(dbPath);
const app = createApp(db);

const server = app.listen(port, () => {
  console.log(`Expense Tracker API listening on http://localhost:${port}`);
  console.log(`SQLite file: ${dbPath}`);
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
