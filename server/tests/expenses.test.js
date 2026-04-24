import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createDb } from '../src/db.js';
import { parseAmountToMinor, formatMinorToString } from '../src/money.js';

// Every test gets a fresh in-memory DB, so tests never share state and can
// run in any order without flake.
function freshApp() {
  const db = createDb(':memory:');
  return createApp(db);
}

function validPayload(overrides = {}) {
  return {
    amount: '199.50',
    category: 'Food',
    description: 'Lunch',
    date: '2026-04-20',
    ...overrides,
  };
}

describe('money helpers', () => {
  it('parses common decimal strings', () => {
    expect(parseAmountToMinor('0.01')).toBe(1);
    expect(parseAmountToMinor('199.5')).toBe(19950);
    expect(parseAmountToMinor('199.50')).toBe(19950);
    expect(parseAmountToMinor('100')).toBe(10000);
  });

  it('rejects invalid shapes without silently coercing', () => {
    expect(parseAmountToMinor('-10')).toBeNull();
    expect(parseAmountToMinor('10.123')).toBeNull();
    expect(parseAmountToMinor('abc')).toBeNull();
    expect(parseAmountToMinor('10.')).toBeNull();
    expect(parseAmountToMinor('')).toBeNull();
    expect(parseAmountToMinor(10)).toBeNull();
  });

  it('round-trips through format', () => {
    expect(formatMinorToString(1)).toBe('0.01');
    expect(formatMinorToString(19950)).toBe('199.50');
    expect(formatMinorToString(0)).toBe('0.00');
  });
});

describe('POST /api/expenses', () => {
  let app;
  beforeEach(() => { app = freshApp(); });

  it('creates an expense and returns integer + formatted amount', async () => {
    const res = await request(app).post('/api/expenses').send(validPayload());
    expect(res.status).toBe(201);
    expect(res.body.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.body.amount_minor).toBe(19950);
    expect(res.body.amount).toBe('199.50');
    expect(res.body.category).toBe('Food');
    expect(res.body.date).toBe('2026-04-20');
    expect(typeof res.body.created_at).toBe('string');
  });

  it('rejects zero, negative, and >2-decimal amounts', async () => {
    for (const amount of ['0', '0.00', '-1', '10.123', 'abc', '']) {
      const res = await request(app).post('/api/expenses').send(validPayload({ amount }));
      expect(res.status, `amount=${amount}`).toBe(400);
      expect(res.body.error.details.amount).toBeDefined();
    }
  });

  it('rejects invalid calendar dates', async () => {
    const res = await request(app)
      .post('/api/expenses')
      .send(validPayload({ date: '2025-02-31' }));
    expect(res.status).toBe(400);
    expect(res.body.error.details.date).toBeDefined();
  });

  it('rejects missing category', async () => {
    const res = await request(app)
      .post('/api/expenses')
      .send(validPayload({ category: '   ' }));
    expect(res.status).toBe(400);
    expect(res.body.error.details.category).toBeDefined();
  });

  it('trims category and description', async () => {
    const res = await request(app)
      .post('/api/expenses')
      .send(validPayload({ category: '  Food  ', description: '  Lunch  ' }));
    expect(res.status).toBe(201);
    expect(res.body.category).toBe('Food');
    expect(res.body.description).toBe('Lunch');
  });

  it('replays the same response for a repeated idempotency key', async () => {
    const key = 'test-key-123';
    const first = await request(app)
      .post('/api/expenses')
      .set('Idempotency-Key', key)
      .send(validPayload());
    expect(first.status).toBe(201);

    const second = await request(app)
      .post('/api/expenses')
      .set('Idempotency-Key', key)
      .send(validPayload({ amount: '999.99', description: 'different' }));
    // Retry must NOT create a second expense, and must return the ORIGINAL
    // response — ignoring the (wrongly) changed body on the retry.
    expect(second.status).toBe(200);
    expect(second.body.id).toBe(first.body.id);
    expect(second.body.amount).toBe('199.50');

    const list = await request(app).get('/api/expenses');
    expect(list.body.data).toHaveLength(1);
  });

  it('treats missing Idempotency-Key as non-idempotent (each request creates)', async () => {
    await request(app).post('/api/expenses').send(validPayload());
    await request(app).post('/api/expenses').send(validPayload());
    const list = await request(app).get('/api/expenses');
    expect(list.body.data).toHaveLength(2);
  });

  it('rejects malformed idempotency keys', async () => {
    const res = await request(app)
      .post('/api/expenses')
      .set('Idempotency-Key', 'has spaces')
      .send(validPayload());
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_idempotency_key');
  });
});

describe('GET /api/expenses', () => {
  let app;
  beforeEach(() => { app = freshApp(); });

  async function seed() {
    await request(app).post('/api/expenses').send(validPayload({
      amount: '100.00', category: 'Food', date: '2026-04-20',
    }));
    await request(app).post('/api/expenses').send(validPayload({
      amount: '50.25', category: 'Travel', date: '2026-04-22',
    }));
    await request(app).post('/api/expenses').send(validPayload({
      amount: '25.00', category: 'Food', date: '2026-04-15',
    }));
  }

  it('returns newest-first by default', async () => {
    await seed();
    const res = await request(app).get('/api/expenses');
    expect(res.status).toBe(200);
    expect(res.body.data.map((e) => e.date)).toEqual([
      '2026-04-22', '2026-04-20', '2026-04-15',
    ]);
  });

  it('filters by category', async () => {
    await seed();
    const res = await request(app).get('/api/expenses?category=Food');
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data.every((e) => e.category === 'Food')).toBe(true);
  });

  it('computes totals server-side (no float drift)', async () => {
    // Classic 0.1 + 0.2 float trap: if we summed in floats we'd get 0.30000000000000004
    await request(app).post('/api/expenses').send(validPayload({ amount: '0.10' }));
    await request(app).post('/api/expenses').send(validPayload({ amount: '0.20' }));

    const res = await request(app).get('/api/expenses');
    expect(res.body.total.amount_minor).toBe(30);
    expect(res.body.total.amount).toBe('0.30');
    expect(res.body.total.count).toBe(2);
  });

  it('total reflects the filter', async () => {
    await seed();
    const res = await request(app).get('/api/expenses?category=Food');
    expect(res.body.total.amount).toBe('125.00');
    expect(res.body.total.count).toBe(2);
  });

  it('groups totals by category', async () => {
    await seed();
    const res = await request(app).get('/api/expenses');
    const byCat = Object.fromEntries(res.body.by_category.map((c) => [c.category, c.amount]));
    expect(byCat.Food).toBe('125.00');
    expect(byCat.Travel).toBe('50.25');
  });
});
