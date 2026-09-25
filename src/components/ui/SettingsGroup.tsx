import type { ReactNode } from "react";

export function SettingsGroup({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="mb-4 rounded-lg border border-border bg-surface">
      {title && <h3 className="px-3 pt-2.5 text-xs font-semibold uppercase tracking-wider text-fg-muted">{title}</h3>}
      <div className="divide-y divide-border-subtle">{children}</div>
    </section>
  );
}

/** Stacked variant of SettingsRow for wide controls (paths, URLs, tokens): label on top, control below. */
export function SettingsField({ label, description, saved, children }: { label: string; description?: string; saved?: boolean; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 px-3 py-2.5">
      <div>
        <div className="flex items-center gap-2 text-base text-fg">
          {label}
          {saved && <span className="text-sm text-accent-text" role="status">Saved</span>}
        </div>
        {description && <p className="mt-0.5 text-sm text-fg-muted">{description}</p>}
      </div>
      {children}
    </div>
  );
}

export function SettingsRow({ label, description, saved, children }: { label: string; description?: string; saved?: boolean; children?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-3 py-2.5">
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-base text-fg">
          {label}
          {saved && <span className="text-sm text-accent-text" role="status">Saved</span>}
        </div>
        {description && <p className="mt-0.5 text-sm text-fg-muted">{description}</p>}
      </div>
      {children && <div className="flex shrink-0 items-center gap-2">{children}</div>}
    </div>
  );
}
