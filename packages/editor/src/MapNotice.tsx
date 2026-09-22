import type { MapView } from "./story-map-view.js";

/**
 * What a story-map section shows when there is no resolved map to lay out (A62): loading, absent, failed, or waiting for the transcript.
 * Returns null when the map is loaded, so a section renders its real body instead.
 */
export function MapNotice({ view, testId }: { view: MapView; testId: string }) {
  const notice = (body: React.ReactNode) => <section className="map-notice" data-testid={testId}>{body}</section>;
  switch (view.status) {
    case "loading": return notice(<p className="muted">Loading the story map…</p>);
    case "absent": return notice(<>
      <p><strong>No story map yet.</strong></p>
      <p className="muted">An agent or script writes <span className="mono">story-map.json</span> in the story directory: the characters, locations, objects, and motifs with the words that mention them, and the acts and beats as word ranges. The page fills in as soon as the file exists.</p>
    </>);
    case "error": return notice(<p className="error">Story map failed. {view.message}</p>);
    case "waiting": return notice(<p className="muted">Waiting for the transcript…</p>);
    case "unresolvable": return notice(<p className="error">Story map does not fit this transcript. {view.message}</p>);
    case "loaded": return null;
  }
}
