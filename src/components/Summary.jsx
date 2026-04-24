import { formatINR } from '../money.js';

export default function Summary({ total, byCategory }) {
  return (
    <section className="summary" aria-label="Expense summary">
      <div className="summary-total">
        <span className="summary-label">Total</span>
        <span className="summary-amount">{formatINR(total?.amount_minor ?? 0)}</span>
        <span className="summary-count">
          {(total?.count ?? 0)} {total?.count === 1 ? 'expense' : 'expenses'}
        </span>
      </div>
      {byCategory && byCategory.length > 0 && (
        <ul className="summary-breakdown">
          {byCategory.map((c) => (
            <li key={c.category}>
              <span className="chip">{c.category}</span>
              <span className="num">{formatINR(c.amount_minor)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
