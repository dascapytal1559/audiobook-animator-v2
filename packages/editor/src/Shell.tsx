import { useCallback, useEffect, useState } from "react";
import { ApiError, getStories, type StoriesResponse } from "./api.js";
import { App } from "./App.js";

/** The open story rides in the URL as `?story=<id>`; a bare URL is the server's default story (A18). */
const STORY_PARAM = "story";
const storyFromUrl = () => new URLSearchParams(window.location.search).get(STORY_PARAM);
const describe = (e: unknown) => (e instanceof ApiError ? `${e.code}: ${e.message}` : e instanceof Error ? e.message : String(e));

/** Loads the story listing once, follows the URL (including back/forward), and mounts a fresh editor per story so no state leaks between clips. */
export function Shell() {
  const [catalog, setCatalog] = useState<StoriesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [urlStory, setUrlStory] = useState<string | null>(storyFromUrl);
  useEffect(() => { getStories().then(setCatalog, e => setError(`Story list failed. ${describe(e)}`)); }, []);
  useEffect(() => {
    const onPopState = () => setUrlStory(storyFromUrl());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  const select = useCallback((storyId: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set(STORY_PARAM, storyId);
    window.history.pushState(null, "", url);
    setUrlStory(storyId);
  }, []);
  if (catalog === null) {
    return (
      <div className="app">
        <header className="header">
          <h1>Story editor</h1>
          {error === null ? <span className="muted">Loading stories…</span> : <span className="error" data-testid="error">{error}</span>}
        </header>
      </div>
    );
  }
  const storyId = urlStory ?? catalog.defaultStoryId;
  return <App key={storyId} storyId={storyId} stories={catalog.stories} onSelectStory={select} />;
}
