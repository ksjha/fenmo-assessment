import { formatINR } from '../money.js';

function formatDate(iso) {
  // iso is YYYY-MM-DD. Parse in local time so "2026-04-20" doesn't drift by
  // a day near a timezone boundary.
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export default function ExpenseList({ expenses, loading, error, onRetry }) {
  if (loading && !expenses) {
    return <div className="placeholder">Loading expenses…</div>;
  }
  if (error) {
    return (
      <div className="placeholder error">
        <p>{error.message}</p>
        <button type="button" onClick={onRetry}>Retry</button>
      </div>
    );
  }
  if (!expenses || expenses.length === 0) {
    return <div className="placeholder">No expenses match the current filter.</div>;
  }

  return (
    <div className="expense-list-wrap">
      <table className="expense-list">
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Category</th>
            <th scope="col">Description</th>
            <th scope="col" className="num">Amount</th>
          </tr>
        </thead>
        <tbody>
          {expenses.map((e) => (
            <tr key={e.id}>
              <td>{formatDate(e.date)}</td>
              <td><span className="chip">{e.category}</span></td>
              <td className="desc">{e.description || <span className="muted">—</span>}</td>
              <td className="num">{formatINR(e.amount_minor)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
