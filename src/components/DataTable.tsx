import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { cn, EmptyState, Spinner } from "./ui";

/** Above this many rows only the visible ones are rendered (thousands of rows freeze the UI). */
const WINDOW_THRESHOLD = 150;
/** Extra rows rendered above and below the viewport. */
const OVERSCAN = 20;

export interface Column<T> {
  key: string;
  header: string;
  /** CSS grid track (e.g. "1fr") or a number of --spacing units. */
  width: string | number;
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
  /** Wraps each rendered row, e.g. in a ContextMenu. The wrapper owns right-click when set. */
  rowWrapper?: (item: T, row: ReactElement) => ReactNode;
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
  rowWrapper,
  selectedId,
  sortKey,
  sortDirection,
  onSort,
  emptyMessage = "No items",
  emptySubtext,
  loading,
}: DataTableProps<T>) {
  const gridTemplateColumns = columns
    .map((c) => (typeof c.width === "number" ? `calc(var(--spacing) * ${c.width})` : c.width))
    .join(" ");
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const scrollRef = useRef<HTMLDivElement>(null);
  const windowed = data.length > WINDOW_THRESHOLD;
  // Rows are a uniform height; measured from the first rendered row (0 until measured).
  const [rowHeight, setRowHeight] = useState(0);
  const [view, setView] = useState({ top: 0, height: 0 });

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !windowed) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      setView({ top: el.scrollTop, height: el.clientHeight });
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    el.addEventListener("scroll", onScroll, { passive: true });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(onScroll) : null;
    ro?.observe(el);
    return () => {
      el.removeEventListener("scroll", onScroll);
      ro?.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [windowed, loading, data.length === 0]);

  // Measure once, from the tallest of the first rows, then lock every row to that height while
  // windowed. Re-measuring on every render made rows of different heights (progress bar vs.
  // status line) flip the height back and forth until React gave up ("Maximum update depth").
  useLayoutEffect(() => {
    if (!windowed || rowHeight > 0) return;
    let h = 0;
    for (const el of rowRefs.current.values()) h = Math.max(h, el.offsetHeight);
    if (h > 0) setRowHeight(h);
  }, [windowed, rowHeight, data.length]);

  // Keep the latest values for the window listeners without re-subscribing every render.
  const latest = useRef({ data, rowKey, selectedId, onKeyboardSelect, onRowClick, rowHeight });
  latest.current = { data, rowKey, selectedId, onKeyboardSelect, onRowClick, rowHeight };

  useEffect(() => {
    const move = (delta: number) => () => {
      const { data, rowKey, selectedId, onKeyboardSelect, onRowClick, rowHeight } = latest.current;
      if (data.length === 0) return;
      const current = selectedId ? data.findIndex((d) => rowKey(d) === selectedId) : -1;
      const next = current === -1 ? 0 : Math.min(data.length - 1, Math.max(0, current + delta));
      const item = data[next];
      // Advance immediately so fast key-repeat doesn't read a stale selection before React re-renders.
      latest.current.selectedId = rowKey(item);
      (onKeyboardSelect ?? onRowClick)?.(item);
      const el = rowRefs.current.get(rowKey(item));
      if (el) el.scrollIntoView({ block: "nearest" });
      else if (scrollRef.current && rowHeight > 0) {
        // Not rendered (outside the window): bring it into view by position.
        const box = scrollRef.current;
        const y = next * rowHeight;
        if (y < box.scrollTop) box.scrollTop = y;
        else if (y + rowHeight * 2 > box.scrollTop + box.clientHeight) box.scrollTop = y + rowHeight * 2 - box.clientHeight;
      }
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

  // Visible slice. Until a row has been measured, render a first screenful to measure.
  let start = 0;
  let end = data.length;
  if (windowed) {
    if (rowHeight > 0) {
      start = Math.max(0, Math.floor(view.top / rowHeight) - OVERSCAN);
      end = Math.min(data.length, Math.ceil((view.top + view.height) / rowHeight) + OVERSCAN);
    } else {
      end = Math.min(data.length, OVERSCAN * 3);
    }
  }
  const rows = start === 0 && end === data.length ? data : data.slice(start, end);
  const before = windowed && rowHeight > 0 ? start : 0;
  const after = windowed && rowHeight > 0 ? data.length - end : 0;

  return (
    <div ref={scrollRef} className="flex-1 overflow-auto" role="table">
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
      {before > 0 && <div aria-hidden style={{ height: before * rowHeight }} />}
      {rows.map((item) => {
        const id = rowKey(item);
        const selected = selectedId === id;
        const row = (
          <div
            key={id}
            ref={(el) => {
              if (el) rowRefs.current.set(id, el);
              else rowRefs.current.delete(id);
            }}
            role="row"
            aria-selected={selected}
            onClick={() => onRowClick?.(item)}
            onContextMenu={
              rowWrapper
                ? undefined
                : (e) => {
                    e.preventDefault();
                    onRowContextMenu?.(item, e);
                  }
            }
            className={cn(
              "grid min-h-7.5 cursor-default items-center gap-3 border-b border-border-subtle px-4 py-1",
              selected ? "bg-selected" : "hover:bg-raised",
            )}
            style={windowed && rowHeight > 0 ? { gridTemplateColumns, height: rowHeight, overflow: "hidden" } : { gridTemplateColumns }}
          >
            {columns.map((col) => (
              <div key={col.key} role="cell" className="min-w-0">
                {col.render(item)}
              </div>
            ))}
          </div>
        );
        return rowWrapper ? <Fragment key={id}>{rowWrapper(item, row)}</Fragment> : row;
      })}
      {after > 0 && <div aria-hidden style={{ height: after * rowHeight }} />}
    </div>
  );
}
