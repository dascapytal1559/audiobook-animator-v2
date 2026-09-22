import { useCallback, useState } from "react";

/**
 * Browser view preferences, never part of the saved timeline: read once from localStorage under `key`, written back as JSON on every
 * change. `parse` turns whatever was stored into a valid value; a missing or unreadable entry yields the fallback. The setter takes a value
 * or an updater of the latest value, like React's, so two toggles in one tick both land.
 */
export function useViewPreference<T>(key: string, fallback: T, parse: (stored: unknown) => T): [T, (next: T | ((previous: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    try { const raw = window.localStorage.getItem(key); return raw === null ? fallback : parse(JSON.parse(raw)); } catch { return fallback; }
  });
  const set = useCallback((next: T | ((previous: T) => T)) => setValue(previous => {
    const resolved = typeof next === "function" ? (next as (previous: T) => T)(previous) : next;
    try { window.localStorage.setItem(key, JSON.stringify(resolved)); } catch { /* view preference only */ }
    return resolved;
  }), [key]);
  return [value, set];
}

/** A stored record of booleans; a key that is missing or not a boolean keeps its default. */
export const booleanFlags = <T extends Record<string, boolean>>(defaults: T) => (stored: unknown): T => {
  const parsed = typeof stored === "object" && stored !== null ? stored as Record<string, unknown> : {};
  return Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => [key, typeof parsed[key] === "boolean" ? parsed[key] : fallback])) as T;
};

/** A stored pane split as a fraction of the container; anything outside [min, max] or not a number keeps the default. */
export const splitRatio = (fallback: number, min = 0.15, max = 0.85) => (stored: unknown): number =>
  typeof stored === "number" && Number.isFinite(stored) ? Math.min(max, Math.max(min, stored)) : fallback;

/** No section may shrink below this many pixels, so its content and drag handle stay reachable. */
export const SECTION_MIN_HEIGHT = 96;
/** What the transport row and the lanes keep of the window when a section is dragged as tall as it goes. */
const LANES_FLOOR = 320;

/** The tallest a resizable section may be in a window of `viewportHeight` pixels: it always leaves the lanes' floor, and never less than the minimum. */
export const sectionMaxHeight = (viewportHeight: number): number => Math.max(SECTION_MIN_HEIGHT, Math.floor(viewportHeight - LANES_FLOOR));

/** The heights the Video and World map sections open at before anyone drags them: shares of the window, held within the same bounds. */
export const defaultSectionHeights = (viewportHeight: number) => {
  const max = sectionMaxHeight(viewportHeight);
  return { video: clampSectionHeight(viewportHeight * 0.42, max), worldMap: clampSectionHeight(viewportHeight * 0.38, max) };
};

/** A section height in whole pixels held within [SECTION_MIN_HEIGHT, max]. */
export const clampSectionHeight = (height: number, max: number): number => Math.round(Math.min(max, Math.max(SECTION_MIN_HEIGHT, height)));

/** A stored record of section heights in pixels; a key that is missing or not a finite number keeps its default, and every value is held within the bounds. */
export const sectionHeights = <T extends Record<string, number>>(defaults: T, max: number) => (stored: unknown): T => {
  const parsed = typeof stored === "object" && stored !== null ? stored as Record<string, unknown> : {};
  const bounded = (value: unknown, fallback: number) => clampSectionHeight(typeof value === "number" && Number.isFinite(value) ? value : fallback, max);
  return Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => [key, bounded(parsed[key], fallback)])) as T;
};
