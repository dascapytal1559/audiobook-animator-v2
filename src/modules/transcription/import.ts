import { join, resolve } from "node:path";
import { Effect, Schema } from "effect";
import { loadDemoInput, readJson, sha256, writeArtifact, writeJson, type DemoInput } from "./artifacts.js";
import { TranscriptionError, type RevDemoResult, type TimedWord } from "./contracts.js";
import { normalizeRevTranscript } from "./normalize.js";

export const JobId = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{1,128}$/));

export function saveNormalizedTranscript(
  demo: DemoInput,
  jobId: string,
  raw: { readonly text: string; readonly value: unknown },
  submission: { readonly method: "api" | "dashboard-export"; readonly durationSeconds: number | null },
): Effect.Effect<RevDemoResult, TranscriptionError> {
  return Effect.gen(function* () {
    const directory = demo.config.artifactDirectory;
    const evidencePath = join(directory, "evidence.json");
    const identity = { schemaVersion: 1, signature: demo.signature, jobId, method: submission.method, rawSha256: sha256(raw.text) };
    const created = yield* writeJson(evidencePath, identity, true);
    if (!created) {
      const existing = yield* readJson(evidencePath, demo.config.maxResponseBytes);
      if (JSON.stringify(existing?.value) !== JSON.stringify(identity)) {
        return yield* Effect.fail(new TranscriptionError({ code: "ArtifactMismatch", message: "This output directory contains evidence for another clip, job, export, or submission method. Choose a separate output directory." }));
      }
    }
    const rawTranscriptPath = join(directory, "transcript.raw.json");
    yield* writeArtifact(rawTranscriptPath, raw.text);
    const parsed = yield* normalizeRevTranscript(raw.value, demo.input, demo.config.timestampToleranceSeconds);
    const durationDifferenceSeconds = submission.durationSeconds === null ? null : submission.durationSeconds - demo.input.durationSeconds;
    const transcriptPath = join(directory, "transcript.json");
    yield* writeJson(transcriptPath, {
      schemaVersion: 1,
      provider: { name: "rev-ai", jobId, submissionMethod: submission.method,
        requestedSettings: submission.method === "api" ? { transcriber: demo.config.transcriber, language: demo.config.language } : null,
        association: submission.method === "api" ? "persisted-submission" : "operator-supplied-export-and-job-id",
        rawSha256: sha256(raw.text), reportedDurationSeconds: submission.durationSeconds,
      },
      input: demo.input,
      provenance: { path: demo.config.provenancePath, sha256: demo.provenanceSha256, evidence: demo.provenance },
      durationDifferenceSeconds,
      checks: { timestampRanges: "validated", recognitionAndCoverage: "not-verified" },
      ...parsed,
    });
    yield* writeArtifact(join(directory, "transcript.txt"), `${parsed.text}\n`);
    return {
      jobId, artifactDirectory: directory, transcriptPath, rawTranscriptPath,
      sourceClock: demo.input.sourceClock, timingCaveat: demo.input.timingCaveat,
      wordCount: parsed.wordCount,
      wordPreview: parsed.elements.filter((element): element is TimedWord => element.kind === "word").slice(0, 12),
      durationDifferenceSeconds,
    };
  });
}

/** Normalize a dashboard export without credentials or any network requests. */
export function importRevDemoTranscript(options: {
  readonly configPath: string;
  readonly transcriptPath: string;
  readonly jobId: string;
}): Effect.Effect<RevDemoResult, TranscriptionError> {
  return Effect.gen(function* () {
    const jobId = yield* Schema.decodeUnknownEffect(JobId)(options.jobId).pipe(
      Effect.mapError(() => new TranscriptionError({ code: "InvalidConfig", message: "Supply the Rev job ID associated with the dashboard export." })),
    );
    const demo = yield* loadDemoInput(options.configPath);
    const raw = yield* readJson(resolve(options.transcriptPath), demo.config.maxResponseBytes);
    if (!raw) return yield* Effect.fail(new TranscriptionError({ code: "InvalidResponse", message: "The supplied Rev transcript export does not exist." }));
    return yield* saveNormalizedTranscript(demo, jobId, raw, { method: "dashboard-export", durationSeconds: null });
  });
}
