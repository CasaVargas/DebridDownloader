import { useEffect, useRef, type ReactNode } from "react";
import { cn, EmptyState, Spinner } from "./ui";

export interface Column<T> {
  key: string;
  header: string;
  width: string;
  sortable?: boolean;
  render: (item: T) => ReactNode;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  rowKey: (item: T) => string;
  onRowClick?: (item: T) => void;
  onRowContextMenu?: (item: T, e: React.MouseEvent) => void;
  /** Called when ↑/↓ moves the selection; falls back to onRowClick. */
  onKeyboardSelect?: (item: T) => void;
  selectedId?: string | null;
  sortKey?: string | null;
  sortDirection?: "asc" | "desc";
  onSort?: (key: string, direction: "asc" | "desc") => void;
  emptyMessage?: string;
  emptySubtext?: string;
  loading?: boolean;
}

export default function DataTable<T>({
  columns,
  data,
  rowKey,
  onRowClick,
  onRowContextMenu,
  onKeyboardSelect,
  selectedId,
  sortKey,
  sortDirection,
  onSort,
  emptyMessage = "No items",
  emptySubtext,
  loading,
}: DataTableProps<T>) {
  const gridTemplateColumns = columns.map((c) => c.width).join(" ");
  const rowRefs = useRef(new Map<string, HTMLDivElement>());

  // Keep the latest values for the window listeners without re-subscribing every render.
  const latest = useRef({ data, rowKey, selectedId, onKeyboardSelect, onRowClick });
  latest.current = { data, rowKey, selectedId, onKeyboardSelect, onRowClick };

  useEffect(() => {
    const move = (delta: number) => () => {
      const { data, rowKey, selectedId, onKeyboardSelect, onRowClick } = latest.current;
      if (data.length === 0) return;
      const current = selectedId ? data.findIndex((d) => rowKey(d) === selectedId) : -1;
      const next = current === -1 ? 0 : Math.min(data.length - 1, Math.max(0, current + delta));
      const item = data[next];
      (onKeyboardSelect ?? onRowClick)?.(item);
      rowRefs.current.get(rowKey(item))?.scrollIntoView({ block: "nearest" });
    };
    const onNext = move(1);
    const onPrev = move(-1);
    window.addEventListener("select-next", onNext);
    window.addEventListener("select-prev", onPrev);
    return () => {
      window.removeEventListener("select-next", onNext);
      window.removeEventListener("select-prev", onPrev);
    };
  }, []);

  const handleHeaderClick = (col: Column<T>) => {
    if (!col.sortable || !onSort) return;
    if (sortKey === col.key) {
      onSort(col.key, sortDirection === "asc" ? "desc" : "asc");
    } else {
      onSort(col.key, "asc");
    }
  };

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center py-24">
        <Spinner />
      </div>
    );
  }

  if (data.length === 0) {
    return <EmptyState title={emptyMessage} hint={emptySubtext} />;
  }

  return (
    <div className="flex-1 overflow-auto" role="table">
      {/* Header */}
      <div
        role="row"
        className="sticky top-0 z-10 grid h-6.5 select-none items-center gap-3 border-b border-border bg-bg px-4 text-xs font-semibold uppercase tracking-wider text-fg-muted"
        style={{ gridTemplateColumns }}
      >
        {columns.map((col) => {
          const active = sortKey === col.key;
          const ariaSort = col.sortable ? (active ? (sortDirection === "asc" ? "ascending" : "descending") : "none") : undefined;
          return (
            <div key={col.key} role="columnheader" aria-sort={ariaSort} className="min-w-0 truncate">
              {col.sortable && onSort ? (
                <button type="button" onClick={() => handleHeaderClick(col)} className="inline-flex items-center gap-1 uppercase tracking-wider hover:text-fg">
                  {col.header}
                  {active && <span className="text-fg">{sortDirection === "asc" ? "↑" : "↓"}</span>}
                </button>
              ) : (
                col.header
              )}
            </div>
          );
        })}
      </div>

      {/* Rows */}
      {data.map((item) => {
        const id = rowKey(item);
        const selected = selectedId === id;
        return (
          <div
            key={id}
            ref={(el) => {
              if (el) rowRefs.current.set(id, el);
              else rowRefs.current.delete(id);
            }}
            role="row"
            aria-selected={selected}
            onClick={() => onRowClick?.(item)}
            onContextMenu={(e) => {
              e.preventDefault();
              onRowContextMenu?.(item, e);
            }}
            className={cn(
              "grid min-h-7.5 cursor-default items-center gap-3 border-b border-border-subtle px-4 py-1",
              selected ? "bg-selected" : "hover:bg-raised",
            )}
            style={{ gridTemplateColumns }}
          >
            {columns.map((col) => (
              <div key={col.key} role="cell" className="min-w-0">
                {col.render(item)}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
