import { Router } from 'express';
import crypto from 'node:crypto';
import { formatMinorToString } from '../money.js';
import { isValidIdempotencyKey, validateExpenseInput } from '../validation.js';

export function createExpensesRouter(db) {
  const router = Router();

  const insertExpense = db.prepare(`
    INSERT INTO expenses (id, amount_minor, category, description, date, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const insertIdempotency = db.prepare(`
    INSERT INTO idempotency_keys (key, expense_id, response_json, created_at)
    VALUES (?, ?, ?, ?)
  `);

  const getIdempotency = db.prepare(
    'SELECT response_json FROM idempotency_keys WHERE key = ?',
  );

  const selectAll = db.prepare(
    `SELECT id, amount_minor, category, description, date, created_at
       FROM expenses
       ORDER BY date DESC, created_at DESC`,
  );
  const selectByCategory = db.prepare(
    `SELECT id, amount_minor, category, description, date, created_at
       FROM expenses
      WHERE category = ?
       ORDER BY date DESC, created_at DESC`,
  );

  // All mutations that touch >1 table run inside a transaction so a crash
  // between the INSERTs can never leave a stale idempotency key or an
  // orphaned expense. node:sqlite doesn't have a transaction() helper, so we
  // wrap BEGIN/COMMIT/ROLLBACK ourselves.
  function createWithIdempotency(row, idempotencyKey, responseJson) {
    db.exec('BEGIN');
    try {
      insertExpense.run(
        row.id, row.amount_minor, row.category, row.description, row.date, row.created_at,
      );
      if (idempotencyKey) {
        insertIdempotency.run(idempotencyKey, row.id, responseJson, row.created_at);
      }
      db.exec('COMMIT');
    } catch (err) {
      try { db.exec('ROLLBACK'); } catch { /* already rolled back */ }
      throw err;
    }
  }

  router.post('/', (req, res) => {
    const idempotencyKey = req.get('Idempotency-Key');
    if (idempotencyKey !== undefined && !isValidIdempotencyKey(idempotencyKey)) {
      return res.status(400).json({
        error: {
          code: 'invalid_idempotency_key',
          message: 'Idempotency-Key must be 1-200 printable ASCII characters',
        },
      });
    }

    if (idempotencyKey) {
      const cached = getIdempotency.get(idempotencyKey);
      if (cached) {
        // Replay: same key seen before. Return the original response so the
        // client sees a consistent view regardless of how many times they
        // retry. Status 200 (not 201) signals "not newly created".
        return res.status(200).json(JSON.parse(cached.response_json));
      }
    }

    const { errors, value } = validateExpenseInput(req.body ?? {});
    if (Object.keys(errors).length > 0) {
      return res.status(400).json({
        error: {
          code: 'validation_error',
          message: 'One or more fields are invalid',
          details: errors,
        },
      });
    }

    const now = new Date().toISOString();
    const row = {
      id: crypto.randomUUID(),
      amount_minor: value.amount_minor,
      category: value.category,
      description: value.description,
      date: value.date,
      created_at: now,
    };

    const response = toExpenseResponse(row);
    const responseJson = JSON.stringify(response);

    try {
      createWithIdempotency(row, idempotencyKey, responseJson);
    } catch (err) {
      // Two concurrent requests with the same key can both miss the SELECT
      // and race to INSERT. The PRIMARY KEY on idempotency_keys makes this
      // deterministic: the loser gets a UNIQUE constraint error, and we
      // resolve by returning the winner's stored response.
      if (idempotencyKey && isUniqueViolation(err)) {
        const cached = getIdempotency.get(idempotencyKey);
        if (cached) {
          return res.status(200).json(JSON.parse(cached.response_json));
        }
      }
      throw err;
    }

    res.status(201).json(response);
  });

  router.get('/', (req, res) => {
    const { category } = req.query;

    // Only one sort mode is in scope (date_desc). Unknown values fall back to
    // the default rather than 400-ing, because sort is a presentation concern
    // and the client shouldn't break if we later add new modes.
    const trimmedCategory =
      typeof category === 'string' && category.trim() !== '' ? category.trim() : null;

    const rows = trimmedCategory
      ? selectByCategory.all(trimmedCategory)
      : selectAll.all();

    // Totals are computed SERVER-SIDE from integer minor units, then formatted
    // once. Summing on the client in floats would reintroduce the precision
    // bug we carefully avoided in storage.
    let totalMinor = 0;
    const byCategoryMinor = new Map();
    for (const row of rows) {
      totalMinor += row.amount_minor;
      byCategoryMinor.set(
        row.category,
        (byCategoryMinor.get(row.category) ?? 0) + row.amount_minor,
      );
    }

    res.json({
      data: rows.map(toExpenseResponse),
      total: {
        amount_minor: totalMinor,
        amount: formatMinorToString(totalMinor),
        count: rows.length,
      },
      by_category: Array.from(byCategoryMinor, ([cat, minor]) => ({
        category: cat,
        amount_minor: minor,
        amount: formatMinorToString(minor),
      })).sort((a, b) => b.amount_minor - a.amount_minor),
    });
  });

  return router;
}

function toExpenseResponse(row) {
  return {
    id: row.id,
    // We ship BOTH the integer and a display string. Clients that do math
    // should use amount_minor; clients that just render should use amount.
    amount_minor: row.amount_minor,
    amount: formatMinorToString(row.amount_minor),
    category: row.category,
    description: row.description,
    date: row.date,
    created_at: row.created_at,
  };
}

// node:sqlite exposes the SQLite extended error code on err.errcode. 1555 =
// SQLITE_CONSTRAINT_PRIMARYKEY, 2067 = SQLITE_CONSTRAINT_UNIQUE. We also fall
// back to a message-substring check in case the driver's shape shifts.
function isUniqueViolation(err) {
  if (!err) return false;
  if (err.errcode === 1555 || err.errcode === 2067) return true;
  return typeof err.message === 'string' && err.message.includes('UNIQUE constraint failed');
}
