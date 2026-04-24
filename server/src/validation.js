import { parseAmountToMinor } from './money.js';

const MAX_DESCRIPTION_LEN = 500;
const MAX_CATEGORY_LEN = 60;
// 100 billion minor units (~1 billion of base currency) is already absurd,
// but we still cap it so an accidental huge number is rejected, not silently
// accepted and later overflowing a 64-bit integer sum.
const MAX_AMOUNT_MINOR = 100_000_000_000;

// Expense dates are day-precision in the user's local calendar. We accept
// strict ISO-8601 YYYY-MM-DD and validate the calendar components so "2025-
// 02-31" is rejected. No timezone gymnastics: an expense on the 24th is on
// the 24th regardless of where the server runs.
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isValidCalendarDate(year, month, day) {
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  const d = new Date(Date.UTC(year, month - 1, day));
  return (
    d.getUTCFullYear() === year &&
    d.getUTCMonth() === month - 1 &&
    d.getUTCDate() === day
  );
}

export function validateExpenseInput(body) {
  const errors = {};
  const out = {};

  // amount
  if (body.amount === undefined || body.amount === null || body.amount === '') {
    errors.amount = 'amount is required';
  } else {
    // Allow number OR string. Numbers are re-stringified so the same strict
    // regex in parseAmountToMinor is the single source of truth.
    const raw = typeof body.amount === 'number' ? String(body.amount) : body.amount;
    const minor = parseAmountToMinor(raw);
    if (minor === null) {
      errors.amount = 'amount must be a positive decimal with at most 2 decimal places';
    } else if (minor === 0) {
      errors.amount = 'amount must be greater than zero';
    } else if (minor > MAX_AMOUNT_MINOR) {
      errors.amount = 'amount is too large';
    } else {
      out.amount_minor = minor;
    }
  }

  // category
  if (typeof body.category !== 'string' || body.category.trim() === '') {
    errors.category = 'category is required';
  } else {
    const c = body.category.trim();
    if (c.length > MAX_CATEGORY_LEN) {
      errors.category = `category must be ${MAX_CATEGORY_LEN} characters or fewer`;
    } else {
      out.category = c;
    }
  }

  // description
  if (body.description === undefined || body.description === null) {
    out.description = '';
  } else if (typeof body.description !== 'string') {
    errors.description = 'description must be a string';
  } else if (body.description.length > MAX_DESCRIPTION_LEN) {
    errors.description = `description must be ${MAX_DESCRIPTION_LEN} characters or fewer`;
  } else {
    out.description = body.description.trim();
  }

  // date
  if (typeof body.date !== 'string' || body.date.trim() === '') {
    errors.date = 'date is required';
  } else {
    const m = DATE_RE.exec(body.date.trim());
    if (!m) {
      errors.date = 'date must be in YYYY-MM-DD format';
    } else {
      const y = Number(m[1]);
      const mo = Number(m[2]);
      const d = Number(m[3]);
      if (!isValidCalendarDate(y, mo, d)) {
        errors.date = 'date is not a valid calendar date';
      } else {
        out.date = `${m[1]}-${m[2]}-${m[3]}`;
      }
    }
  }

  return { errors, value: out };
}

// Idempotency keys are opaque client-generated identifiers. We accept any
// printable ASCII up to 200 chars — this covers UUIDs, ULIDs, and hashes
// without locking the client into one format.
const IDEMPOTENCY_KEY_RE = /^[\x21-\x7e]{1,200}$/;

export function isValidIdempotencyKey(key) {
  return typeof key === 'string' && IDEMPOTENCY_KEY_RE.test(key);
}
