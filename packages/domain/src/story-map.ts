/**
 * The story map (A62): who and what recurs in a story, and how its narration is structured. An agent or script writes
 * `<story>/story-map.json`; the editor's explorer reads it. Every range is a pair of transcript word ids, inclusive at both ends, so the
 * map stays valid under timing edits and is resolved to samples on read, the way shot anchors are (A51).
 */
import { Schema } from "effect";
import { ClipIdentity, Producer } from "./identity.js";
import { Id, IsoUtc, Path, Text } from "./schema.js";

export const SubjectKind = Schema.Literals(["character", "location", "object", "motif"]);
export type SubjectKind = typeof SubjectKind.Type;
export const SUBJECT_KINDS: ReadonlyArray<SubjectKind> = SubjectKind.literals;
export const SectionKind = Schema.Literals(["act", "chapter", "scene", "beat"]);
export type SectionKind = typeof SectionKind.Type;
export const SECTION_KINDS: ReadonlyArray<SectionKind> = SectionKind.literals;

/** An inclusive run of transcript words, by id. */
export const WordRange = Schema.Struct({ startWordId: Text, endWordId: Text });
export type WordRange = typeof WordRange.Type;
/** A reference image kept beside the story: a path relative to the story directory, and what it shows. */
export const SubjectImage = Schema.Struct({ path: Path, role: Text });
export type SubjectImage = typeof SubjectImage.Type;
/** A character, location, object, or motif, with the word runs where the narration names or clearly refers to it. */
export const Subject = Schema.Struct({
  id: Id, kind: SubjectKind, name: Text, description: Schema.optionalKey(Text),
  mentions: Schema.Array(WordRange), images: Schema.optionalKey(Schema.Array(SubjectImage)),
});
export type Subject = typeof Subject.Type;
/** A run of the narration with a role in the story's structure. Sections nest by containment: a beat inside an act is simply a beat whose words lie inside the act's. */
export const Section = Schema.Struct({ id: Id, kind: SectionKind, title: Text, summary: Schema.optionalKey(Text), ...WordRange.fields });
export type Section = typeof Section.Type;
/** `<story>/story-map.json`, pinned to the clip identity like every per-story artifact. */
export const StoryMap = Schema.Struct({
  schemaVersion: Schema.Literal(1), kind: Schema.Literal("story-map"), clip: ClipIdentity, createdAt: IsoUtc, producer: Producer,
  subjects: Schema.Array(Subject), sections: Schema.Array(Section),
});
export type StoryMap = typeof StoryMap.Type;

/** A relative path that cannot leave the story directory: no root, no drive, no empty or `..` segment. Whether the file exists is the server's check. */
export const isInsidePath = (path: string): boolean => !path.startsWith("/") && !/^[a-zA-Z]:/.test(path) && path.split(/[\\/]/).every(segment => segment !== "" && segment !== "..");

type MapShape = { readonly subjects: ReadonlyArray<Subject>; readonly sections: ReadonlyArray<Section> };
const indexOf = (wordIds: ReadonlyArray<string>) => new Map(wordIds.map((id, i) => [id, i] as const));

/** Every rule a map must satisfy against its transcript's word order; empty when it is usable. Each problem names the subject or section that broke it. */
export function storyMapProblems(map: MapShape, wordIds: ReadonlyArray<string>): ReadonlyArray<string> {
  const index = indexOf(wordIds);
  const problems: string[] = [];
  const rangeProblem = (owner: string, range: WordRange): string | null => {
    const a = index.get(range.startWordId);
    const b = index.get(range.endWordId);
    if (a === undefined) return `${owner} names an unknown word ${range.startWordId}`;
    if (b === undefined) return `${owner} names an unknown word ${range.endWordId}`;
    return b < a ? `${owner} ends at ${range.endWordId} before it starts at ${range.startWordId}` : null;
  };
  const subjectIds = new Set<string>();
  for (const subject of map.subjects) {
    if (subjectIds.has(subject.id)) problems.push(`subject ${subject.id} appears twice`);
    subjectIds.add(subject.id);
    subject.mentions.forEach((mention, i) => { const p = rangeProblem(`subject ${subject.id} mention ${i}`, mention); if (p !== null) problems.push(p); });
    (subject.images ?? []).forEach((image, i) => { if (!isInsidePath(image.path)) problems.push(`subject ${subject.id} image ${i} must be a relative path inside the story directory, not ${image.path}`); });
  }
  const sectionIds = new Set<string>();
  const spans: Array<{ id: string; a: number; b: number }> = [];
  for (const section of map.sections) {
    if (sectionIds.has(section.id)) problems.push(`section ${section.id} appears twice`);
    sectionIds.add(section.id);
    const p = rangeProblem(`section ${section.id}`, section);
    if (p !== null) { problems.push(p); continue; }
    spans.push({ id: section.id, a: index.get(section.startWordId)!, b: index.get(section.endWordId)! });
  }
  for (let i = 0; i < spans.length; i++) for (let j = i + 1; j < spans.length; j++) {
    const x = spans[i]!;
    const y = spans[j]!;
    if (x.a === y.a && x.b === y.b) { problems.push(`sections ${x.id} and ${y.id} cover the same words`); continue; }
    const disjoint = x.b < y.a || y.b < x.a;
    const nested = (x.a <= y.a && y.b <= x.b) || (y.a <= x.a && x.b <= y.b);
    if (!disjoint && !nested) problems.push(`sections ${x.id} and ${y.id} overlap without one containing the other`);
  }
  return problems;
}

/** What resolving needs from a word: the effective times, whichever layer they come from. */
export type MapWord = { readonly id: string; readonly value: string; readonly startSample: number; readonly endSample: number };
/** A word range on the clip clock. Times are the earliest start and latest end among its words, so an inverted edit cannot produce a negative span. */
export type ResolvedRange = WordRange & { readonly startSample: number; readonly endSample: number; readonly wordCount: number; readonly text: string };
export type ResolvedSection = Section & ResolvedRange & {
  /** The nearest enclosing section, or null at the top level. */
  readonly parentId: string | null;
  readonly depth: number;
  /** Subjects with a mention inside this section, in map order. */
  readonly subjectIds: ReadonlyArray<string>;
};
export type ResolvedSubject<S extends Subject = Subject> = Omit<S, "mentions"> & {
  readonly mentions: ReadonlyArray<ResolvedRange>;
  /** Sections, at any depth, that hold at least one mention, in section order. */
  readonly sectionIds: ReadonlyArray<string>;
};
export type ResolvedStoryMap<S extends Subject = Subject> = { readonly sections: ReadonlyArray<ResolvedSection>; readonly subjects: ReadonlyArray<ResolvedSubject<S>> };

/**
 * The map on the clip clock: sections in narration order with parents before children, mentions timed and quoted, and the subject/section
 * cross-references. `words` are the effective words in transcript order. Throws RangeError on a map `storyMapProblems` would reject.
 */
export function resolveStoryMap<S extends Subject>(map: { readonly subjects: ReadonlyArray<S>; readonly sections: ReadonlyArray<Section> }, words: ReadonlyArray<MapWord>): ResolvedStoryMap<S> {
  const index = indexOf(words.map(w => w.id));
  const span = (range: WordRange): { a: number; b: number } => {
    const a = index.get(range.startWordId);
    const b = index.get(range.endWordId);
    if (a === undefined || b === undefined || b < a) throw new RangeError(`Story map range ${range.startWordId}..${range.endWordId} is not a run of transcript words.`);
    return { a, b };
  };
  const resolve = (range: WordRange): ResolvedRange => {
    const { a, b } = span(range);
    const run = words.slice(a, b + 1);
    return { startWordId: range.startWordId, endWordId: range.endWordId, startSample: Math.min(...run.map(w => w.startSample)), endSample: Math.max(...run.map(w => w.endSample)), wordCount: run.length, text: run.map(w => w.value).join(" ") };
  };
  const ordered = map.sections.map(section => ({ section, ...span(section) })).sort((x, y) => x.a - y.a || y.b - x.b);
  const stack: Array<{ id: string; b: number; depth: number }> = [];
  const sections: ResolvedSection[] = [];
  const mentionSpans = map.subjects.map(subject => ({ id: subject.id, spans: subject.mentions.map(span) }));
  for (const { section, a, b } of ordered) {
    while (stack.length > 0 && stack[stack.length - 1]!.b < a) stack.pop();
    const parent = stack[stack.length - 1];
    const depth = parent === undefined ? 0 : parent.depth + 1;
    const subjectIds = mentionSpans.filter(s => s.spans.some(m => m.a <= b && a <= m.b)).map(s => s.id);
    sections.push({ ...section, ...resolve(section), parentId: parent?.id ?? null, depth, subjectIds });
    stack.push({ id: section.id, b, depth });
  }
  const subjects = map.subjects.map(subject => ({ ...subject, mentions: subject.mentions.map(resolve).sort((x, y) => x.startSample - y.startSample), sectionIds: sections.filter(s => s.subjectIds.includes(subject.id)).map(s => s.id) }));
  return { sections, subjects };
}

/**
 * The chain of sections the playhead is in, outermost first: at each depth the last section that has started, holding until the next
 * one at that depth starts, as shots hold (A30). A child only counts while its parent is the current one at the depth above.
 */
export function currentSections(sections: ReadonlyArray<ResolvedSection>, sample: number): ReadonlyArray<ResolvedSection> {
  const chain: ResolvedSection[] = [];
  for (const section of sections) {
    if (section.startSample > sample) continue;
    chain.length = section.depth;
    if (section.depth > 0 && chain[section.depth - 1]?.id !== section.parentId) continue;
    chain.push(section);
  }
  return chain;
}
