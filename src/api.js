// API client. Two concerns beyond basic fetch:
//
// 1. Idempotency: every createExpense() call carries a client-generated UUID
//    in the Idempotency-Key header. If the network flakes and the client
//    retries — or if the user mashes Submit, or refreshes right after
//    submitting — the server returns the SAME response without creating a
//    duplicate row. The key is generated ONCE per logical submission (not
//    per attempt) and is passed in by the caller.
//
// 2. Error shape: the server always responds with { error: { code, message,
//    details? } } on non-2xx. We surface that as a typed ApiError so the UI
//    can branch on .code (e.g. show per-field messages for validation_error).

const API_BASE = import.meta.env.VITE_API_BASE ?? '';

export class ApiError extends Error {
  constructor({ status, code, message, details }) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function request(path, { method = 'GET', body, headers = {}, signal } = {}) {
  let response;
  try {
    response = await fetch(`${API_BASE}/api${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (err) {
    // Network error, CORS preflight failure, server down, etc. We normalise
    // to the same ApiError shape so the UI has exactly one failure type to
    // reason about.
    if (err?.name === 'AbortError') throw err;
    throw new ApiError({
      status: 0,
      code: 'network_error',
      message: 'Could not reach the server. Check your connection and try again.',
    });
  }

  // Some responses (e.g. 204) have no body. We treat empty-body 2xx as {}.
  const text = await response.text();
  const payload = text ? safeJson(text) : {};

  if (!response.ok) {
    const errObj = payload?.error ?? {};
    throw new ApiError({
      status: response.status,
      code: errObj.code ?? 'unknown_error',
      message: errObj.message ?? `Request failed (${response.status})`,
      details: errObj.details,
    });
  }

  return payload;
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function listExpenses({ category, signal } = {}) {
  const params = new URLSearchParams();
  if (category) params.set('category', category);
  params.set('sort', 'date_desc');
  return request(`/expenses?${params.toString()}`, { signal });
}

export function createExpense(expense, { idempotencyKey, signal } = {}) {
  return request('/expenses', {
    method: 'POST',
    body: expense,
    headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {},
    signal,
  });
}

// Client-generated idempotency key. crypto.randomUUID is available in every
// browser Vite targets (ES2022+).
export function newIdempotencyKey() {
  return crypto.randomUUID();
}
