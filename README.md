# Expense Tracker

A small full-stack personal-expense tracker, built for the Fenmo assessment.

- **Backend:** Node.js + Express, persisted with SQLite (via the built-in `node:sqlite`).
- **Frontend:** React 19 + Vite.
- **Tests:** Vitest + supertest on the backend.

The emphasis is on **money correctness**, **idempotent writes under retries**, and **clean separation of concerns** — not on polish or feature count.

---

## Running locally

Prerequisites: **Node 22.5+** (required for the built-in `node:sqlite`; Node 24 recommended).

```bash
# 1. Install
npm install                 # frontend deps
npm install --prefix server # backend deps

# 2. Run the API (terminal 1)
npm run start --prefix server        # production mode
# or: npm run dev --prefix server    # auto-restart on file change

# 3. Run the UI (terminal 2)
npm run dev
```

Open <http://localhost:5173>. The Vite dev server proxies `/api/*` to `http://localhost:3001`, so the frontend always talks to one origin.

### Tests

```bash
npm test --prefix server
```

16 integration tests covering create/list/filter/sort, money parsing edge cases, idempotency replay, concurrent-retry races, and the classic `0.1 + 0.2` float trap.

---

## API

All responses use `application/json`. Errors share one envelope:

```json
{ "error": { "code": "validation_error", "message": "...", "details": { "amount": "..." } } }
```

### `POST /api/expenses`

```http
POST /api/expenses
Content-Type: application/json
Idempotency-Key: <opaque-client-generated-id>   (optional but recommended)

{
  "amount": "199.50",     // decimal string; 2 decimals max; > 0
  "category": "Food",
  "description": "Lunch", // optional
  "date": "2026-04-20"    // YYYY-MM-DD, strict calendar validation
}
```

- `201 Created` — newly created; returns the expense.
- `200 OK` — replay; same `Idempotency-Key` was seen before, original response returned.
- `400 Bad Request` — validation error (with `details` per field) or malformed idempotency key.

### `GET /api/expenses?category=Food&sort=date_desc`

Returns:

```json
{
  "data": [ { "id": "...", "amount_minor": 19950, "amount": "199.50", "category": "Food", "description": "Lunch", "date": "2026-04-20", "created_at": "..." } ],
  "total":       { "amount_minor": 19950, "amount": "199.50", "count": 1 },
  "by_category": [ { "category": "Food", "amount_minor": 19950, "amount": "199.50" } ]
}
```

Both the raw integer (`amount_minor`) and a formatted string (`amount`) are returned. Clients that do math use the integer; clients that render use the string.

---

## Key design decisions

### 1. Money is stored and transported as **integer minor units**

Never as a float. `199.50` becomes `19950` paise in SQLite and on the wire. Decimal-string on input, parsed with a strict regex — `parseFloat` is not used anywhere. This eliminates the entire class of `0.1 + 0.2 = 0.30000000000000004` bugs. There's an explicit test for that sum.

Totals are computed **server-side** from the integers and shipped pre-formatted. Summing on the client in floats would reintroduce the bug we just avoided.

### 2. Writes are idempotent via an `Idempotency-Key` header

This is the non-trivial part of the assignment. The spec says the API must behave correctly when the client retries a POST after a network failure or page reload. My approach:

- The client generates a UUID **once per logical submission** and reuses it across retries (stored in a `useRef` so React re-renders don't rotate it).
- The server caches the *original response body* keyed by `Idempotency-Key` in a dedicated SQLite table.
- A retry with the same key returns the **original** response (HTTP 200, not 201) — even if the retry's body differs from the first call. That's a client bug, but surfacing it as a conflict would break the common case where the second call is just the browser re-playing the exact same request.
- The key insert runs inside the same transaction as the expense insert, so a crash halfway through can't leave a ghost key or an orphan row.
- If two concurrent retries both miss the cache and race to INSERT, the `PRIMARY KEY` on `idempotency_keys` serializes them: the loser's `UNIQUE` violation is caught and resolved by re-reading the winner's stored response.

On the client, `ExpenseForm` **does not rotate the key on failure** — it only rotates after a successful 2xx. A user clicking Submit three times on a flaky network produces at most one row.

### 3. SQLite with `node:sqlite`

SQLite because: the data fits one file, the workload is trivial, and it gives us real ACID transactions (which we rely on for idempotency). `node:sqlite` (Node 22.5+) over `better-sqlite3` because it has **no native build step** — the reviewer doesn't need Visual Studio / gcc installed to run this. The schema maps directly to Postgres (`BIGSERIAL`, `TIMESTAMPTZ`) if we ever outgrow SQLite.

### 4. Dates are day-precision, no timezones

`YYYY-MM-DD` strings. An expense on the 20th is on the 20th regardless of where the server runs. I validate the *calendar* (so `2025-02-31` is rejected, not silently rolled into March). No ISO timestamps for the expense itself, only for `created_at` (server-assigned UTC).

### 5. Server is the source of truth for validation

The form does client-side validation for snappy feedback, but any 400 from the server overrides it and surfaces per-field errors. A drifted client cannot silently submit bad data.

### 6. Handling the three "realistic conditions" from the spec

| Scenario | Handling |
|---|---|
| User double-clicks Submit | Button disables during in-flight request **and** the same Idempotency-Key guards against the case where the first click's request is still pending when the second starts. |
| User refreshes after submitting | Idempotency-Key means retrying the same POST after a reload cannot create a duplicate. |
| Slow / failed API responses | Loading state on the form (`Saving…`) and on the list. The `useExpenses` hook uses `AbortController` + a request-id to prevent a late response from overwriting a newer one when the user rapidly changes filters. Errors render an inline retry, not a dead page. |

---

## Trade-offs made because of the timebox

- **No auth, no users.** The assignment doesn't need it; adding it would eat time without demonstrating anything.
- **No PATCH / DELETE endpoints.** Only POST + GET are required. Expenses are append-only in this version — simpler, and it sidesteps thinking about how edits should interact with the idempotency cache.
- **No pagination.** Fine for hundreds of rows; a real deployment would add `?limit` / `?cursor` before this scales.
- **Category is free-form text, not a fixed enum.** Lets the user type what they want at the cost of "Food" vs "food" being different. A real product would either normalize-on-write or promote categories to a separate table — I left it simple.
- **Single currency (INR).** Hardcoded in the display layer. Multi-currency would require a currency column and an FX story that's out of scope here.
- **Idempotency keys don't expire.** A real deployment would TTL them (e.g. 24h) to cap table growth.
- **No frontend tests.** Backend is where the correctness risks concentrate (money, idempotency). Testing the form's happy path through the DOM would add boilerplate without catching a bug class the server tests don't already cover.
- **No deploy link.** I haven't wired a hosted deploy in this pass. The project runs locally with the two `npm` commands above; a deployment target (Render, Fly, Railway) would mount a persistent volume for `server/data/expenses.db`.

## What I intentionally did NOT do

- **Did not** add ORM layers (Drizzle/Prisma) — the schema is two tables and five queries. An ORM would be dead weight.
- **Did not** introduce a state management library (Redux/Zustand) — two `useState` calls and a hook cover it.
- **Did not** use TypeScript despite the temptation — the scaffold was plain JS and converting mid-assessment would have traded time against more valuable work on correctness.
- **Did not** implement edit/delete for expenses — the spec doesn't require them, and adding them would have opened questions (how does an edit interact with a cached idempotent response?) that deserve more thought than a timebox allows.
- **Did not** treat idempotency key collisions as 409 Conflict. They're returned as the original 200 response instead. A strict REST purist might disagree; my reasoning is in the design-decisions section above.

---

## Project layout

```
/                   Vite React frontend (kept at repo root to preserve the scaffold)
  src/
    components/     Presentational + form components
    hooks/          useExpenses — the one stateful hook
    api.js          Fetch wrapper with typed ApiError and idempotency-key helper
    money.js        Format integer paise as INR (client)
  vite.config.js    Dev proxy /api -> :3001

/server             Express + node:sqlite API
  src/
    app.js          Express app factory (exported for tests)
    db.js           Schema + migrations
    money.js        parseAmountToMinor / formatMinorToString (single source of truth)
    validation.js   validateExpenseInput
    routes/expenses.js
    index.js        Entry point (boots the HTTP server)
  tests/
    expenses.test.js
```
