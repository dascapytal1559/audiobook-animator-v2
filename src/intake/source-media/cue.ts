import type { CueSheetEvidence, CueTrack, EvidenceIssue } from "./contracts.js";

/** Parse only the declared single-file subset; retain all text and report other directives. */
export function parseEmbeddedCue(raw: string): CueSheetEvidence {
  const files: Array<{ name: string; type: string }> = [];
  const tracks: Array<{ number: number; fileOrdinal: number; title: string | null; index01: CueTrack["index01"] }> = [];
  const issues: EvidenceIssue[] = [];
  let title: string | null = null;
  let unsupported = false;
  let invalid = false;
  const issue = (code: string, message: string, line: number, kind: "invalid" | "unsupported" = "invalid") => {
    if (kind === "unsupported") unsupported = true;
    else invalid = true;
    issues.push({ code, severity: "error", message, location: `CUESHEET line ${line}` });
  };

  const lines = raw.replace(/^\uFEFF/, "").split(/\r?\n/);
  for (const [offset, originalLine] of lines.entries()) {
    const line = originalLine.trim();
    const lineNumber = offset + 1;
    if (line === "") continue;
    // REM comments do not change timing. The full text remains available in raw.
    if (/^REM(?:\s|$)/.test(line)) continue;
    let match = /^FILE "([^"\r\n]+)" (\S+)$/.exec(line);
    if (match) {
      const name = match[1]!;
      const type = match[2]!;
      files.push({ name, type });
      if (files.length > 1) issue("CueMultipleFiles", "Multiple FILE sections are outside the supported subset.", lineNumber, "unsupported");
      if (!["MP3", "WAVE", "AIFF"].includes(type)) issue("CueFileType", `FILE type ${type} is outside the supported subset.`, lineNumber, "unsupported");
      continue;
    }
    match = /^TRACK (\d+) (\S+)$/.exec(line);
    if (match) {
      const number = Number(match[1]);
      if (!Number.isSafeInteger(number) || number < 1 || number > 99) issue("CueTrackNumber", "TRACK numbers must be integers from 1 to 99.", lineNumber);
      if (tracks.some((track) => track.number >= number)) issue("CueTrackOrder", "TRACK numbers must be unique and increasing.", lineNumber);
      if (files.length === 0) issue("CueMissingFile", "TRACK must follow a FILE declaration.", lineNumber);
      if (match[2] !== "AUDIO") issue("CueTrackType", "Only AUDIO tracks are supported.", lineNumber, "unsupported");
      tracks.push({ number, fileOrdinal: files.length - 1, title: null, index01: null });
      continue;
    }
    match = /^TITLE "([^"\r\n]*)"$/.exec(line);
    if (match) {
      const track = tracks.at(-1);
      if (track) {
        if (track.title !== null) issue("CueDuplicateTitle", "A track has more than one TITLE.", lineNumber);
        else track.title = match[1]!;
      } else if (title !== null) issue("CueDuplicateTitle", "The sheet has more than one TITLE.", lineNumber);
      else title = match[1]!;
      continue;
    }
    match = /^INDEX (\d+) (\d+):(\d{2}):(\d{2})$/.exec(line);
    if (match) {
      const track = tracks.at(-1);
      if (!track) {
        issue("CueMissingTrack", "INDEX must follow a TRACK declaration.", lineNumber);
        continue;
      }
      if (match[1] !== "01") {
        issue("CueIndexType", "Only INDEX 01 is supported; pregaps and other indexes require separate handling.", lineNumber, "unsupported");
        continue;
      }
      if (track.index01 !== null) {
        issue("CueDuplicateIndex", "A track has more than one INDEX 01.", lineNumber);
        continue;
      }
      const minutes = BigInt(match[2]!);
      const seconds = Number(match[3]);
      const frames = Number(match[4]);
      const totalFrames = (minutes * 60n + BigInt(seconds)) * 75n + BigInt(frames);
      if (seconds >= 60 || frames >= 75 || totalFrames > BigInt(Number.MAX_SAFE_INTEGER)) {
        issue("CueInvalidTime", "CUE time must use minutes:seconds:frames with seconds below 60, frames below 75, and a safe total frame count.", lineNumber);
        continue;
      }
      track.index01 = { raw: `${match[2]}:${match[3]}:${match[4]}`, totalFrames: String(totalFrames), framesPerSecond: 75, seconds: Number(totalFrames) / 75 };
      continue;
    }
    const directive = line.split(/\s/, 1)[0]!;
    if (["FILE", "TRACK", "TITLE", "INDEX"].includes(directive)) {
      issue("CueMalformedDirective", `Malformed ${directive} directive; only the documented quoted-file subset is supported.`, lineNumber);
    } else {
      issue("CueUnsupportedDirective", `Directive ${directive} is outside the supported subset.`, lineNumber, "unsupported");
    }
  }
  if (files.length === 0) issue("CueMissingFile", "The sheet has no FILE declaration.", 1);
  if (tracks.length === 0) issue("CueMissingTracks", "The sheet has no TRACK declarations.", 1);
  for (const [ordinal, track] of tracks.entries()) {
    if (track.index01 === null) issue("CueMissingIndex", `Track ${track.number} has no valid INDEX 01.`, lines.length);
    const previous = tracks[ordinal - 1];
    if (previous?.fileOrdinal === track.fileOrdinal && previous.index01 && track.index01 && BigInt(track.index01.totalFrames) <= BigInt(previous.index01.totalFrames)) {
      issue("CueTimeOrder", `Track ${track.number} does not start after the previous track.`, lines.length);
    }
  }
  return { raw, status: invalid ? "invalid" : unsupported ? "unsupported" : "valid", files, title, tracks, issues };
}
