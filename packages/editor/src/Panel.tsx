import { useRef, useState, type ReactNode } from "react";
import { Divider } from "./Divider.js";

type Props = {
  /** Stable id: names the section in test ids and the aria relation between the control and the body. */
  id: string;
  title: string;
  /** Whether the body is shown; the owner keeps it as a browser view preference (A63). */
  open: boolean;
  onToggle: () => void;
  /** The body's height in pixels, kept by the owner as a browser view preference. The handle on the bottom edge reports a new one, or an updater of the latest, and the owner clamps it. */
  height: number;
  onResize: (next: number | ((previous: number) => number)) => void;
  /** How far one arrow-key press on the handle moves the edge, in pixels. */
  step?: number;
  children: ReactNode;
};

const KEY_STEP = 24;

/**
 * One collapsible section of the single editor page (A63): a heading row with the section's name and a minimize/expand control, the body
 * below it at the remembered height, and a drag handle on the bottom edge that resizes the body. Minimized, only the heading row stays,
 * so whatever follows on the page moves up; the height waits for the next expand.
 */
export function Panel({ id, title, open, onToggle, height, onResize, step = KEY_STEP, children }: Props) {
  const bodyId = `panel-${id}`;
  const [dragging, setDragging] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  return (
    <section className={`panel panel-${id}${open ? "" : " minimized"}${dragging ? " dragging" : ""}`} data-testid={`panel-${id}`}>
      <div className="panel-head">
        <button type="button" className="panel-toggle" onClick={onToggle} aria-expanded={open} aria-controls={bodyId} data-testid={`panel-toggle-${id}`}>
          <span className={`chevron${open ? " open" : ""}`} aria-hidden="true">▸</span>
          <span className="panel-title">{title}</span>
          <span className="muted panel-hint">{open ? "Minimize" : "Expand"}</span>
        </button>
      </div>
      {open && <>
        <div ref={body} className="panel-body" id={bodyId} style={{ height }} data-testid={`panel-body-${id}`}>{children}</div>
        <Divider
          axis="y" label={`Resize ${title}`} onDragging={axis => setDragging(axis !== null)}
          onDrag={pointer => { if (body.current !== null) onResize(pointer.y - body.current.getBoundingClientRect().top); }}
          onStep={direction => onResize(previous => previous + direction * step)}
        />
      </>}
    </section>
  );
}
