import type { ReactNode } from "react";

type Props = {
  /** Stable id: names the section in test ids and the aria relation between the control and the body. */
  id: string;
  title: string;
  /** Whether the body is shown; the owner keeps it as a browser view preference (A63). */
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
};

/**
 * One collapsible section of the single editor page (A63): a heading row with the section's name and a minimize/expand control, and the
 * body below it. Minimized, only the heading row stays, so whatever follows on the page moves up.
 */
export function Panel({ id, title, open, onToggle, children }: Props) {
  const bodyId = `panel-${id}`;
  return (
    <section className={`panel panel-${id}${open ? "" : " minimized"}`} data-testid={`panel-${id}`}>
      <div className="panel-head">
        <button type="button" className="panel-toggle" onClick={onToggle} aria-expanded={open} aria-controls={bodyId} data-testid={`panel-toggle-${id}`}>
          <span className={`chevron${open ? " open" : ""}`} aria-hidden="true">▸</span>
          <span className="panel-title">{title}</span>
          <span className="muted panel-hint">{open ? "Minimize" : "Expand"}</span>
        </button>
      </div>
      {open && <div className="panel-body" id={bodyId}>{children}</div>}
    </section>
  );
}
