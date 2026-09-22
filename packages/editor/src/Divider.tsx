import type { KeyboardEvent, PointerEvent } from "react";

type Props = {
  axis: "x" | "y";
  label: string;
  /** Called with the pointer's position and the parent's box on every move from press to release; the owner turns it into a size. */
  onDrag: (pointer: { x: number; y: number }, parent: DOMRect) => void;
  /** Called with a step of +1 (right or down) or -1 (left or up) for the arrow keys, so the handle works without a mouse. */
  onStep: (direction: -1 | 1) => void;
  onDragging: (axis: "x" | "y" | null) => void;
};

/**
 * A drag handle between two panes, or under a section. It captures the pointer so the drag keeps reporting when the pointer leaves the
 * handle, and takes focus so the arrow keys move it too. The owner clamps whatever it reports.
 */
export function Divider({ axis, label, onDrag, onStep, onDragging }: Props) {
  const report = (e: PointerEvent<HTMLDivElement>) => onDrag({ x: e.clientX, y: e.clientY }, e.currentTarget.parentElement!.getBoundingClientRect());
  const start = (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    onDragging(axis);
  };
  const move = (e: PointerEvent<HTMLDivElement>) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) report(e); };
  const stop = (e: PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    onDragging(null);
  };
  const keys = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = axis === "x" ? { ArrowLeft: -1, ArrowRight: 1 }[e.key] : { ArrowUp: -1, ArrowDown: 1 }[e.key];
    if (step === undefined) return;
    e.preventDefault();
    onStep(step as -1 | 1);
  };
  return (
    <div
      className={`divider divider-${axis}`} role="separator" tabIndex={0} aria-label={label} aria-orientation={axis === "x" ? "vertical" : "horizontal"}
      data-testid={`divider-${axis}`} onPointerDown={start} onPointerMove={move} onPointerUp={stop} onPointerCancel={stop} onKeyDown={keys}
    />
  );
}
