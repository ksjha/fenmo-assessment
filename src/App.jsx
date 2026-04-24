import { useMemo, useState } from 'react';
import ExpenseForm from './components/ExpenseForm.jsx';
import ExpenseList from './components/ExpenseList.jsx';
import Filters from './components/Filters.jsx';
import Summary from './components/Summary.jsx';
import { useExpenses } from './hooks/useExpenses.js';
import './App.css';

// Derive the filtered view + its total from the single unfiltered fetch.
// Summing in integer MINOR units keeps the total exact (no float drift);
// we only format to a string at the end.
function deriveView(data, selectedCategory) {
  if (!data) return { expenses: null, total: null, byCategory: null };

  const all = data.data;
  const expenses = selectedCategory
    ? all.filter((e) => e.category === selectedCategory)
    : all;

  let totalMinor = 0;
  for (const e of expenses) totalMinor += e.amount_minor;

  // by_category breakdown is shown only when viewing all categories. With a
  // filter applied, a one-row breakdown would be noise.
  const byCategory = selectedCategory ? null : data.by_category;

  return {
    expenses,
    total: { amount_minor: totalMinor, count: expenses.length },
    byCategory,
  };
}

export default function App() {
  const [category, setCategory] = useState(null);
  const { data, loading, error, refetch } = useExpenses();

  const categories = useMemo(() => {
    const set = new Set();
    for (const e of data?.data ?? []) set.add(e.category);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [data]);

  const { expenses, total, byCategory } = useMemo(
    () => deriveView(data, category),
    [data, category],
  );

  return (
    <div className="app">
      <header className="app-header">
        <h1>Expense Tracker</h1>
        <p className="tagline">Record and review your expenses.</p>
      </header>

      <main className="app-main">
        <aside className="sidebar">
          <ExpenseForm onCreated={refetch} />
        </aside>

        <section className="content">
          <div className="content-controls">
            <Filters
              categories={categories}
              selected={category}
              onChange={setCategory}
              onClear={() => setCategory(null)}
            />
          </div>

          <Summary total={total} byCategory={byCategory} />

          <ExpenseList
            expenses={expenses}
            loading={loading}
            error={error}
            onRetry={refetch}
          />
        </section>
      </main>
    </div>
  );
}
