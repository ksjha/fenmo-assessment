import express from 'express';
import cors from 'cors';
import { createExpensesRouter } from './routes/expenses.js';

export function createApp(db) {
  const app = express();

  // In production the frontend is served behind the same origin (or via the
  // Vite dev proxy), so CORS is a convenience for local hacking / Postman.
  app.use(cors());
  app.use(express.json({ limit: '16kb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.use('/api/expenses', createExpensesRouter(db));

  // Consistent error envelope.
  app.use((req, res) => {
    res.status(404).json({
      error: { code: 'not_found', message: `No route for ${req.method} ${req.path}` },
    });
  });

  // Final safety net: log and hide internals. Any thrown error from a route
  // lands here instead of leaking a stack trace to the client.
  app.use((err, _req, res, _next) => {
    console.error('[server error]', err);
    res.status(500).json({
      error: { code: 'internal_error', message: 'Something went wrong' },
    });
  });

  return app;
}
