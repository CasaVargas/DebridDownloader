import type { ReactNode } from "react";

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
  selectedId,
  sortKey,
  sortDirection,
  onSort,
  emptyMessage = "No items",
  emptySubtext,
  loading,
}: DataTableProps<T>) {
  const gridTemplateColumns = columns.map((c) => c.width).join(" ");

  const handleHeaderClick = (col: Column<T>) => {
    if (!col.sortable || !onSort) return;
    if (sortKey === col.key) {
      onSort(col.key, sortDirection === "asc" ? "desc" : "asc");
    } else {
      onSort(col.key, "asc");
    }
  };

  const sortArrow = (col: Column<T>) => {
    if (!col.sortable) return null;
    if (sortKey !== col.key) return <span style={{ color: "var(--theme-text-ghost)" }}> ↕</span>;
    return <span style={{ color: "var(--accent)" }}> {sortDirection === "asc" ? "↑" : "↓"}</span>;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-6 h-6 border-2 border-[rgba(16,185,129,0.3)] border-t-[var(--accent)] rounded-full animate-spin" />
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24">
        <p className="text-[var(--theme-text-muted)] text-[15px]">{emptyMessage}</p>
        {emptySubtext && (
          <p className="text-[var(--theme-text-ghost)] text-[14px] mt-1">{emptySubtext}</p>
        )}
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto" style={{ paddingLeft: "28px", paddingRight: "80px" }}>
      {/* Header */}
      <div
        className="sticky top-0 z-10"
        style={{
          display: "grid",
          gridTemplateColumns,
          gap: "16px",
          borderBottom: "1px solid var(--theme-border)",
          background: "var(--theme-bg-content)",
        }}
      >
        {columns.map((col) => (
          <div
            key={col.key}
            onClick={() => handleHeaderClick(col)}
            className="text-[12px] text-[var(--theme-text-muted)] uppercase tracking-[0.5px] py-3 select-none"
            style={{ cursor: col.sortable ? "pointer" : "default" }}
          >
            {col.header}
            {sortArrow(col)}
          </div>
        ))}
      </div>

      {/* Rows */}
      {data.map((item) => {
        const id = rowKey(item);
        return (
          <div
            key={id}
            onClick={() => onRowClick?.(item)}
            onContextMenu={(e) => {
              e.preventDefault();
              onRowContextMenu?.(item, e);
            }}
            className="transition-colors duration-150 cursor-pointer"
            style={{
              display: "grid",
              gridTemplateColumns,
              gap: "16px",
              alignItems: "center",
              padding: "14px 0",
              borderBottom: "1px solid var(--theme-hover)",
              background:
                selectedId === id
                  ? "var(--accent-bg)0.04)"
                  : undefined,
            }}
            onMouseEnter={(e) => {
              if (selectedId !== id) {
                (e.currentTarget as HTMLElement).style.background =
                  "var(--theme-hover)";
              }
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background =
                selectedId === id
                  ? "var(--accent-bg)0.04)"
                  : "transparent";
            }}
          >
            {columns.map((col) => (
              <div key={col.key} className="min-w-0">
                {col.render(item)}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
