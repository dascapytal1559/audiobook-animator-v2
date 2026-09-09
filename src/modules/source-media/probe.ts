import { Effect, Schema } from "effect";
import {
  SourceMediaError,
  type AudioStreamEvidence,
  type ChapterEvidence,
  type EvidenceIssue,
  type ProbedMedia,
} from "./contracts.js";
import { parseEmbeddedCue } from "./cue.js";

const JsonObject = Schema.Record(Schema.String, Schema.Unknown);
const ProbeDocument = Schema.Struct({
  streams: Schema.Array(JsonObject),
  format: Schema.optionalKey(JsonObject),
  chapters: Schema.optionalKey(Schema.Array(Schema.Unknown)),
});
const StreamHeader = Schema.Struct({
  index: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })),
  codec_type: Schema.String,
});
const ChapterTiming = Schema.Struct({
  start: Schema.Union([Schema.String, Schema.Finite]),
  end: Schema.Union([Schema.String, Schema.Finite]),
  time_base: Schema.String,
});

function decimal(value: unknown): number | null {
  if (typeof value !== "string" || !/^-?\d+(?:\.\d+)?$/.test(value)) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function integerTicks(value: number | string): bigint | null {
  if (typeof value === "number") return Number.isSafeInteger(value) ? BigInt(value) : null;
  return /^-?\d+$/.test(value) ? BigInt(value) : null;
}

function chapterGapSign(current: NonNullable<ChapterEvidence["timing"]>, previous: NonNullable<ChapterEvidence["timing"]>): bigint {
  const [currentNumerator, currentDenominator] = current.timeBase.split("/");
  const [previousNumerator, previousDenominator] = previous.timeBase.split("/");
  // Compare exact rational positions; rounded seconds can hide a real gap or overlap.
  return BigInt(current.startTicks) * BigInt(currentNumerator!) * BigInt(previousDenominator!)
    - BigInt(previous.endTicks) * BigInt(previousNumerator!) * BigInt(currentDenominator!);
}

/** Structural failures fail inspection; imperfect metadata remains inspectable with issues. */
export function parseFfprobeOutput(
  json: string,
  options: { readonly audioStreamIndex?: number; readonly cueChapterToleranceSeconds: number },
): Effect.Effect<ProbedMedia, SourceMediaError> {
  return Effect.gen(function* () {
    const unknownDocument = yield* Effect.try({
      try: (): unknown => JSON.parse(json),
      catch: () => new SourceMediaError({ code: "MalformedProbe", message: "ffprobe did not return valid JSON." }),
    });
    const document = yield* Schema.decodeUnknownEffect(ProbeDocument)(unknownDocument).pipe(
      Effect.mapError(() => new SourceMediaError({ code: "MalformedProbe", message: "ffprobe JSON must contain a streams array and correctly shaped optional format/chapters fields." })),
    );
    const streams = yield* Effect.forEach(document.streams, (raw) => Schema.decodeUnknownEffect(StreamHeader)(raw).pipe(
      Effect.map((header) => ({ ...header, raw })),
      Effect.mapError(() => new SourceMediaError({ code: "MalformedProbe", message: "A stream has no valid codec_type or nonnegative integer index." })),
    ));
    if (new Set(streams.map((stream) => stream.index)).size !== streams.length) {
      return yield* Effect.fail(new SourceMediaError({ code: "MalformedProbe", message: "ffprobe returned duplicate stream indices." }));
    }
    const audioStreams = streams.filter((stream) => stream.codec_type === "audio");
    const audioStreamIndices = audioStreams.map((stream) => stream.index);
    if (audioStreams.length === 0) return yield* Effect.fail(new SourceMediaError({ code: "NoAudioStream", message: "The source contains no audio stream." }));
    if (options.audioStreamIndex === undefined && audioStreams.length > 1) {
      return yield* Effect.fail(new SourceMediaError({ code: "AmbiguousAudioStreams", message: "The source has multiple audio streams; select one explicitly.", details: { audioStreamIndices } }));
    }
    const selected = options.audioStreamIndex === undefined ? audioStreams[0]! : audioStreams.find((stream) => stream.index === options.audioStreamIndex);
    if (!selected) return yield* Effect.fail(new SourceMediaError({ code: "AudioStreamNotFound", message: "The selected stream index is not an audio stream.", details: { selectedIndex: options.audioStreamIndex, audioStreamIndices } }));

    const issues: EvidenceIssue[] = [];
    const addIssue = (code: string, message: string, location: string, severity: "warning" | "error" = "warning") => {
      issues.push({ code, message, location, severity });
    };
    const numeric = (raw: unknown, location: string, positive = false, integer = false): number | null => {
      if (raw === undefined || raw === "N/A") return null;
      const result = decimal(raw);
      if (result === null || (positive && result <= 0) || (integer && !Number.isSafeInteger(result))) {
        addIssue("InvalidNumericMetadata", "Expected a finite decimal value with the required range and precision.", location, "error");
        return null;
      }
      return result;
    };
    const text = (raw: unknown, location: string): string | null => {
      if (raw === undefined) return null;
      if (typeof raw === "string") return raw;
      addIssue("InvalidTextMetadata", "Expected a text metadata value.", location, "error");
      return null;
    };
    const rawAudio = selected.raw;
    const channels = rawAudio["channels"];
    const validChannels = typeof channels === "number" && Number.isSafeInteger(channels) && channels > 0;
    if (channels !== undefined && !validChannels) addIssue("InvalidChannelCount", "Audio channels must be a positive integer.", `streams[${selected.index}].channels`, "error");
    const audio: AudioStreamEvidence = {
      index: selected.index,
      codec: text(rawAudio["codec_name"], "audio.codec_name"),
      sampleRateHz: numeric(rawAudio["sample_rate"], "audio.sample_rate", true, true),
      channels: validChannels ? channels : null,
      channelLayout: text(rawAudio["channel_layout"], "audio.channel_layout"),
      bitRate: numeric(rawAudio["bit_rate"], "audio.bit_rate", true, true),
      durationSeconds: numeric(rawAudio["duration"], "audio.duration", true),
      startTimeSeconds: numeric(rawAudio["start_time"], "audio.start_time"),
      raw: rawAudio,
    };
    const format = document.format ?? {};
    const formatDurationSeconds = numeric(format["duration"], "format.duration", true);
    const duration = audio.durationSeconds !== null
      ? { seconds: audio.durationSeconds, source: "audio-stream" as const }
      : formatDurationSeconds !== null ? { seconds: formatDurationSeconds, source: "format" as const } : null;
    if (duration === null) addIssue("MissingDuration", "Neither the selected audio stream nor the container reports a usable duration.", "duration");

    const chapters: ChapterEvidence[] = [];
    for (const [ordinal, raw] of (document.chapters ?? []).entries()) {
      let timing: ChapterEvidence["timing"] = null;
      try {
        const value = Schema.decodeUnknownSync(ChapterTiming)(raw);
        const base = /^(\d+)\/(\d+)$/.exec(value.time_base);
        const start = integerTicks(value.start);
        const end = integerTicks(value.end);
        if (!base || start === null || end === null || BigInt(base[1]!) === 0n || BigInt(base[2]!) === 0n) throw new Error("Invalid integer timing");
        const numerator = BigInt(base[1]!);
        const denominator = BigInt(base[2]!);
        const startSeconds = Number(start * numerator) / Number(denominator);
        const endSeconds = Number(end * numerator) / Number(denominator);
        if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds)) throw new Error("Unrepresentable timing");
        timing = { startTicks: String(start), endTicks: String(end), timeBase: value.time_base, startSeconds, endSeconds };
        if (start < 0n || end <= start) addIssue("InvalidChapterRange", "Chapter must have a nonnegative start and an end after its start.", `chapters[${ordinal}]`, "error");
        if (duration && endSeconds > duration.seconds + options.cueChapterToleranceSeconds) addIssue("ChapterBeyondDuration", "Chapter ends after the reported selected-media duration and configured tolerance.", `chapters[${ordinal}]`, "error");
      } catch {
        addIssue("MalformedChapterTiming", "Chapter must have exact integer start/end ticks and a positive rational time_base; unsafe JSON integers cannot be recovered.", `chapters[${ordinal}]`, "error");
      }
      chapters.push({ ordinal, raw, timing });
      const previous = chapters[ordinal - 1]?.timing;
      if (previous && timing) {
        const gap = chapterGapSign(timing, previous);
        if (gap < 0n) addIssue("ChapterOverlap", "Chapter starts before the previous chapter ends.", `chapters[${ordinal}]`, "error");
        if (gap > 0n) addIssue("ChapterGap", "There is a gap between adjacent chapters.", `chapters[${ordinal}]`);
      }
    }

    const cueSheets: Array<{ tag: string; evidence: ReturnType<typeof parseEmbeddedCue> }> = [];
    const tags = format["tags"];
    if (tags !== undefined && (tags === null || typeof tags !== "object" || Array.isArray(tags))) {
      addIssue("MalformedFormatTags", "Format tags must be a JSON object.", "format.tags", "error");
    } else if (tags && typeof tags === "object") {
      for (const [tag, raw] of Object.entries(tags)) {
        if (tag.toUpperCase() !== "CUESHEET") continue;
        if (typeof raw !== "string") addIssue("MalformedCueTag", "Embedded CUESHEET must be text.", `format.tags.${tag}`, "error");
        else {
          const evidence = parseEmbeddedCue(raw);
          cueSheets.push({ tag, evidence });
          issues.push(...evidence.issues);
        }
      }
    }
    if (cueSheets.length > 1) addIssue("ConflictingCueTags", "Multiple case-insensitive CUESHEET tags are present; none is selected for comparison.", "format.tags", "error");
    const comparison: Array<{ chapterOrdinal: number; cueTrackOrdinal: number; cueMinusChapterSeconds: number; withinTolerance: boolean }> = [];
    const cue = cueSheets.length === 1 ? cueSheets[0]!.evidence : undefined;
    if (cue?.status === "valid" && chapters.length > 0) {
      if (cue.tracks.length !== chapters.length) addIssue("ChapterCueCountMismatch", "Chapter and CUE track counts differ; no positional comparison is made.", "chapters/CUESHEET", "error");
      else for (const [ordinal, chapter] of chapters.entries()) {
        const start = cue.tracks[ordinal]!.index01;
        if (!start || !chapter.timing) continue;
        const difference = start.seconds - chapter.timing.startSeconds;
        const withinTolerance = Math.abs(difference) <= options.cueChapterToleranceSeconds;
        comparison.push({ chapterOrdinal: ordinal, cueTrackOrdinal: ordinal, cueMinusChapterSeconds: difference, withinTolerance });
        if (!withinTolerance) addIssue("ChapterCueTimingMismatch", "Positional chapter/CUE starts differ beyond the configured comparison tolerance; this is not a semantic title mapping.", `chapters[${ordinal}]/CUESHEET`, "error");
      }
    }
    return {
      audio, audioStreamIndices, format, formatDurationSeconds, duration, chapters, cueSheets,
      chapterCueComparison: { basis: "ordinal-diagnostic-only", toleranceSeconds: options.cueChapterToleranceSeconds, entries: comparison },
      issues,
    };
  });
}
