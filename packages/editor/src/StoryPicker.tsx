import type { StorySummary } from "./api.js";

type Props = { stories: ReadonlyArray<StorySummary>; value: string; onChange: (storyId: string) => void };

/** Header story selector: one option group per book (in first-seen order), stories shortest first as in the inventory. */
export function StoryPicker({ stories, value, onChange }: Props) {
  const books = new Map<string, { title: string; stories: StorySummary[] }>();
  for (const story of stories) {
    const book = books.get(story.bookId) ?? { title: story.bookTitle, stories: [] };
    book.stories.push(story);
    books.set(story.bookId, book);
  }
  const known = stories.some(s => s.id === value);
  return (
    <label className="story-picker">
      <span className="muted">Story</span>
      <select value={value} onChange={e => onChange(e.target.value)} data-testid="story-picker" aria-label="Story">
        {value === "" ? <option value="" disabled>Choose a story…</option> : !known && <option value={value} disabled>{value} (not on this server)</option>}
        {[...books].map(([bookId, book]) => (
          <optgroup key={bookId} label={book.title}>
            {[...book.stories].sort((a, b) => a.durationSeconds - b.durationSeconds).map(s => <option key={s.id} value={s.id}>{s.title} · {durationLabel(s.durationSeconds)}</option>)}
          </optgroup>
        ))}
      </select>
    </label>
  );
}

/** `h:mm:ss`, rounded to the second, matching the inventory's reading view. */
export function durationLabel(seconds: number): string {
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
