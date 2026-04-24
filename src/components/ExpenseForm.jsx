import { useRef, useState } from 'react';
import { ApiError, createExpense, newIdempotencyKey } from '../api.js';

const AMOUNT_RE = /^\d{1,12}(\.\d{0,2})?$/;

function todayIso() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function emptyForm() {
  return { amount: '', category: '', description: '', date: todayIso() };
}

// Client-side validation mirrors the server's rules so the user gets instant
// feedback. The SERVER is still authoritative — any error it returns is
// surfaced as-is into fieldErrors, so a drifted client can't silently submit
// bad data.
function validate(values) {
  const errors = {};
  if (!values.amount || !AMOUNT_RE.test(values.amount.trim())) {
    errors.amount = 'Enter an amount like 199.50';
  } else if (Number(values.amount) <= 0) {
    errors.amount = 'Amount must be greater than zero';
  }
  if (!values.category.trim()) errors.category = 'Category is required';
  if (!values.date) errors.date = 'Date is required';
  return errors;
}

export default function ExpenseForm({ onCreated }) {
  const [values, setValues] = useState(emptyForm);
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitError, setSubmitError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // Key is generated ONCE per logical submission and reused across retries.
  // A fresh submission (successful or abandoned) gets a new key.
  const idempotencyKeyRef = useRef(null);

  function setField(name, value) {
    setValues((v) => ({ ...v, [name]: value }));
    if (fieldErrors[name]) setFieldErrors((e) => ({ ...e, [name]: undefined }));
    if (submitError) setSubmitError(null);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (submitting) return;                           // defence against double-submit

    const errors = validate(values);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    if (!idempotencyKeyRef.current) {
      idempotencyKeyRef.current = newIdempotencyKey();
    }

    setSubmitting(true);
    setSubmitError(null);
    try {
      const created = await createExpense(
        {
          amount: values.amount.trim(),
          category: values.category.trim(),
          description: values.description.trim(),
          date: values.date,
        },
        { idempotencyKey: idempotencyKeyRef.current },
      );
      // Successful submission: rotate the key so the next entry is a new
      // logical submission, not a retry of this one.
      idempotencyKeyRef.current = null;
      setValues(emptyForm());
      onCreated?.(created);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'validation_error' && err.details) {
        setFieldErrors(err.details);
      } else {
        setSubmitError(err instanceof ApiError ? err.message : 'Something went wrong.');
      }
      // IMPORTANT: do NOT rotate the idempotency key on error. If the user
      // retries (or the failure was a network blip where the server actually
      // persisted the row), re-sending the same key guarantees at-most-one
      // creation.
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="expense-form" onSubmit={handleSubmit} noValidate>
      <h2>Add expense</h2>

      <div className="field">
        <label htmlFor="amount">Amount (₹)</label>
        <input
          id="amount"
          type="text"
          inputMode="decimal"
          placeholder="199.50"
          value={values.amount}
          onChange={(e) => setField('amount', e.target.value)}
          aria-invalid={!!fieldErrors.amount}
          aria-describedby={fieldErrors.amount ? 'amount-error' : undefined}
          autoComplete="off"
        />
        {fieldErrors.amount && (
          <p className="field-error" id="amount-error">{fieldErrors.amount}</p>
        )}
      </div>

      <div className="field">
        <label htmlFor="category">Category</label>
        <input
          id="category"
          type="text"
          placeholder="Food, Travel, Rent..."
          value={values.category}
          onChange={(e) => setField('category', e.target.value)}
          aria-invalid={!!fieldErrors.category}
          aria-describedby={fieldErrors.category ? 'category-error' : undefined}
          autoComplete="off"
          maxLength={60}
        />
        {fieldErrors.category && (
          <p className="field-error" id="category-error">{fieldErrors.category}</p>
        )}
      </div>

      <div className="field">
        <label htmlFor="date">Date</label>
        <input
          id="date"
          type="date"
          value={values.date}
          onChange={(e) => setField('date', e.target.value)}
          aria-invalid={!!fieldErrors.date}
          aria-describedby={fieldErrors.date ? 'date-error' : undefined}
          max={todayIso()}
        />
        {fieldErrors.date && (
          <p className="field-error" id="date-error">{fieldErrors.date}</p>
        )}
      </div>

      <div className="field">
        <label htmlFor="description">Description <span className="muted">(optional)</span></label>
        <input
          id="description"
          type="text"
          placeholder="Lunch with team"
          value={values.description}
          onChange={(e) => setField('description', e.target.value)}
          autoComplete="off"
          maxLength={500}
        />
      </div>

      {submitError && (
        <div className="form-error" role="alert">{submitError}</div>
      )}

      <button className="primary" type="submit" disabled={submitting}>
        {submitting ? 'Saving…' : 'Add expense'}
      </button>
    </form>
  );
}
