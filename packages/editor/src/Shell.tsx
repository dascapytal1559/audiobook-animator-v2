import { useCallback, useEffect, useState } from "react";
import { ApiError, getStories, type StoriesResponse } from "./api.js";
import { App } from "./App.js";
import { StoryPicker } from "./StoryPicker.js";

/** The open story rides in the URL as `?story=<id>`. A bare URL opens the story this browser last showed, else the picker; the server has no default. */
const STORY_PARAM = "story";
const STORAGE_KEY = "animator.editor.lastStory";
const storyFromUrl = () => new URLSearchParams(window.location.search).get(STORY_PARAM);
const rememberedStory = () => { try { return window.localStorage.getItem(STORAGE_KEY); } catch { return null; } };
const rememberStory = (id: string) => { try { window.localStorage.setItem(STORAGE_KEY, id); } catch { /* storage unavailable: nothing to remember into */ } };
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
  const remembered = rememberedStory();
  const storyId = urlStory ?? (catalog !== null && remembered !== null && catalog.stories.some(s => s.id === remembered) ? remembered : null);
  useEffect(() => { if (storyId !== null && catalog !== null && catalog.stories.some(s => s.id === storyId)) rememberStory(storyId); }, [storyId, catalog]);
  if (catalog === null || storyId === null) {
    return (
      <div className="app">
        <header className="header">
          <h1>Story editor</h1>
          {catalog !== null && <StoryPicker stories={catalog.stories} value="" onChange={select} />}
          {error !== null ? <span className="error" data-testid="error">{error}</span> : catalog === null ? <span className="muted">Loading stories…</span> : <span className="muted">Choose a story to open.</span>}
        </header>
      </div>
    );
  }
  return <App key={storyId} storyId={storyId} stories={catalog.stories} onSelectStory={select} />;
}
