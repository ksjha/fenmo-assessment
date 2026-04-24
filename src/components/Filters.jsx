export default function Filters({ categories, selected, onChange, onClear }) {
  return (
    <div className="filters">
      <label htmlFor="category-filter">Filter by category</label>
      <select
        id="category-filter"
        value={selected ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
      >
        <option value="">All categories</option>
        {categories.map((c) => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>
      {selected && (
        <button type="button" className="link" onClick={onClear}>Clear</button>
      )}
    </div>
  );
}
