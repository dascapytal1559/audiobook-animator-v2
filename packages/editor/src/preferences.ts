import { useCallback, useState } from "react";

/**
 * Browser view preferences, never part of the saved timeline: read once from localStorage under `key`, written back as JSON on every
 * change. `parse` turns whatever was stored into a valid value; a missing or unreadable entry yields the fallback.
 */
export function useViewPreference<T>(key: string, fallback: T, parse: (stored: unknown) => T): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try { const raw = window.localStorage.getItem(key); return raw === null ? fallback : parse(JSON.parse(raw)); } catch { return fallback; }
  });
  const set = useCallback((next: T) => { setValue(next); try { window.localStorage.setItem(key, JSON.stringify(next)); } catch { /* view preference only */ } }, [key]);
  return [value, set];
}

/** A stored record of booleans; a key that is missing or not a boolean keeps its default. */
export const booleanFlags = <T extends Record<string, boolean>>(defaults: T) => (stored: unknown): T => {
  const parsed = typeof stored === "object" && stored !== null ? stored as Record<string, unknown> : {};
  return Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => [key, typeof parsed[key] === "boolean" ? parsed[key] : fallback])) as T;
};
