import { partitionStatusItems, type StatusItem } from "../status-bar";

export type { StatusItem } from "../status-bar";

function StatusBarItem({ item }: { item: StatusItem }) {
  return (
    <div className="status-bar__item" title={item.title}>
      {item.label ? (
        <span className="status-bar__label">{item.label}</span>
      ) : null}
      <span className="status-bar__value">{item.value}</span>
    </div>
  );
}

// Compact single-line bar docked at the bottom of the app shell.
export function StatusBar({ items }: { items: readonly StatusItem[] }) {
  const { start, end } = partitionStatusItems(items);
  return (
    <footer aria-label="Status" className="status-bar">
      <div className="status-bar__group">
        {start.map((item) => (
          <StatusBarItem item={item} key={item.id} />
        ))}
      </div>
      <div className="status-bar__group status-bar__group--end">
        {end.map((item) => (
          <StatusBarItem item={item} key={item.id} />
        ))}
      </div>
    </footer>
  );
}
