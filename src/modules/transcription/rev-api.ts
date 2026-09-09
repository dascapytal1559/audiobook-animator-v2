import { readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { Effect, Redacted, Schema } from "effect";
import { loadDemoInput, readJson, writeJson, type DemoInput } from "./artifacts.js";
import { Sha256, TranscriptionError, type RevDemoResult } from "./contracts.js";
import { JobId, saveNormalizedTranscript } from "./import.js";

/** A concrete HTTP seam for offline tests, not a provider abstraction. */
export type RevFetch = (url: string, init: RequestInit) => Promise<Response>;

const Job = Schema.Struct({
  id: JobId,
  status: Schema.Literals(["in_progress", "transcribed", "failed"]),
  metadata: Schema.String,
  duration_seconds: Schema.optionalKey(Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))),
});
const SavedJob = Schema.Struct({ signature: Sha256, id: JobId });
const Reservation = Schema.Struct({ signature: Sha256, metadata: Schema.String });

function requestJson(
  demo: DemoInput,
  token: Redacted.Redacted<string>,
  fetch: RevFetch,
  path: string,
  init: RequestInit,
  timeoutMs: number,
): Effect.Effect<{ readonly text: string; readonly value: unknown }, TranscriptionError> {
  return Effect.tryPromise({
    try: async (signal) => {
      const response = await fetch(`${demo.config.apiBaseUrl}${path}`, {
        ...init, redirect: "error",
        signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
        headers: { Authorization: `Bearer ${Redacted.value(token)}`, Accept: path.endsWith("/transcript") ? "application/vnd.rev.transcript.v1.0+json" : "application/json" },
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new TranscriptionError({ code: "HttpFailed", message: `Rev returned HTTP ${response.status}. No response body or credential is logged.` });
      }
      if (!response.body) throw new TranscriptionError({ code: "InvalidResponse", message: "Rev returned no response body." });
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let length = 0;
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          length += next.value.byteLength;
          if (length > demo.config.maxResponseBytes) {
            await reader.cancel();
            throw new TranscriptionError({ code: "InvalidResponse", message: "Rev response exceeds the configured byte limit." });
          }
          chunks.push(next.value);
        }
      } finally { reader.releaseLock(); }
      const text = Buffer.concat(chunks).toString("utf8");
      return { text, value: JSON.parse(text) as unknown };
    },
    catch: (error) => error instanceof TranscriptionError ? error : new TranscriptionError({ code: "HttpFailed", message: "Rev request failed, timed out, or returned invalid JSON. Credentials and response bodies are not logged." }),
  });
}

function decodeJob(raw: unknown, expectedId: string, metadata: string): Effect.Effect<typeof Job.Type, TranscriptionError> {
  return Effect.gen(function* () {
    const job = yield* Schema.decodeUnknownEffect(Job)(raw).pipe(
      Effect.mapError(() => new TranscriptionError({ code: "InvalidResponse", message: "Rev job response has an invalid ID, status, metadata, or duration." })),
    );
    if (job.id !== expectedId || job.metadata !== metadata) {
      return yield* Effect.fail(new TranscriptionError({ code: "ArtifactMismatch", message: "Rev job ID or metadata does not match this clip submission. No new job was submitted." }));
    }
    return job;
  });
}

/** POST is never retried. A durable reservation prevents duplicate payment after uncertain failures. */
export function runRevDemo(options: {
  readonly configPath: string;
  readonly token: Redacted.Redacted<string>;
  readonly resumeJobId?: string;
}, fetch: RevFetch = globalThis.fetch): Effect.Effect<RevDemoResult, TranscriptionError> {
  return Effect.gen(function* () {
    if (!/^[^\s]+$/.test(Redacted.value(options.token))) {
      return yield* Effect.fail(new TranscriptionError({ code: "MissingCredential", message: "Set REV_AI_API_KEY to a nonempty token without whitespace. It is not saved or logged." }));
    }
    const demo = yield* loadDemoInput(options.configPath);
    const directory = demo.config.artifactDirectory;
    const metadata = `animator-rev-demo:${demo.signature}`;
    const reservationPath = join(directory, "submission.json");
    const jobPath = join(directory, "job.json");
    const statusPath = join(directory, "job-status.raw.json");
    const reservation = yield* readJson(reservationPath, demo.config.maxResponseBytes);
    const saved = yield* readJson(jobPath, demo.config.maxResponseBytes);
    if (!reservation && !saved) {
      // Missing state is not evidence that no paid job exists. Inspect names before parsing remnants.
      const entries = yield* Effect.tryPromise({
        try: async () => {
          try { return await readdir(directory); } catch (error) {
            if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return [];
            throw error;
          }
        },
        catch: () => new TranscriptionError({ code: "ArtifactIoFailed", message: "Cannot inspect the artifact directory before submission. No new job was submitted." }),
      });
      if (entries.length > 0) {
        return yield* Effect.fail(new TranscriptionError({ code: "SubmissionUncertain", message: "The artifact directory contains files but its submission and job records are missing. Reconcile the existing provider job and artifacts before retrying; no new paid job was submitted." }));
      }
    }
    const evidence = yield* readJson(join(directory, "evidence.json"), demo.config.maxResponseBytes);
    if (evidence && typeof evidence.value === "object" && evidence.value !== null && "method" in evidence.value && evidence.value.method !== "api") {
      return yield* Effect.fail(new TranscriptionError({ code: "ArtifactMismatch", message: "This directory contains a dashboard export. Import it again or select a separate directory for an API experiment." }));
    }
    if (reservation) {
      const stored = yield* Schema.decodeUnknownEffect(Reservation)(reservation.value).pipe(
        Effect.mapError(() => new TranscriptionError({ code: "SubmissionUncertain", message: "The saved submission is incomplete. Reconcile the provider job before retrying; no automatic POST is allowed." })),
      );
      if (stored.signature !== demo.signature || stored.metadata !== metadata) {
        return yield* Effect.fail(new TranscriptionError({ code: "ArtifactMismatch", message: "The saved submission belongs to different input or provider settings. Choose a separate artifact directory." }));
      }
    }
    let jobId: string;
    if (saved) {
      const job = yield* Schema.decodeUnknownEffect(SavedJob)(saved.value).pipe(
        Effect.mapError(() => new TranscriptionError({ code: "InvalidResponse", message: "The saved job ID is invalid. Do not resubmit until it is reconciled." })),
      );
      if (!reservation || job.signature !== demo.signature || (options.resumeJobId !== undefined && job.id !== options.resumeJobId)) {
        return yield* Effect.fail(new TranscriptionError({ code: "ArtifactMismatch", message: "The saved job does not match this submission or the supplied recovery ID." }));
      }
      jobId = job.id;
    } else if (options.resumeJobId !== undefined) {
      jobId = yield* Schema.decodeUnknownEffect(JobId)(options.resumeJobId).pipe(
        Effect.mapError(() => new TranscriptionError({ code: "InvalidConfig", message: "Invalid Rev recovery job ID." })),
      );
      if (!reservation) return yield* Effect.fail(new TranscriptionError({ code: "ArtifactMismatch", message: "API recovery requires the original submission record to verify the source association." }));
      const raw = yield* requestJson(demo, options.token, fetch, `/jobs/${jobId}`, { method: "GET" }, demo.config.requestTimeoutMs);
      yield* decodeJob(raw.value, jobId, metadata);
      yield* writeJson(jobPath, { signature: demo.signature, id: jobId, recoveredAt: new Date().toISOString(), raw: raw.value });
    } else {
      if (reservation) return yield* Effect.fail(new TranscriptionError({ code: "SubmissionUncertain", message: "A submission was started but no job ID was saved. Reconcile it in Rev, then supply --job-id. This run will not submit another paid job." }));
      const created = yield* writeJson(reservationPath, {
        schemaVersion: 1, state: "submitting", signature: demo.signature, metadata,
        startedAt: new Date().toISOString(), input: demo.input, provenanceSha256: demo.provenanceSha256,
        settings: { transcriber: demo.config.transcriber, language: demo.config.language },
      }, true);
      if (!created) return yield* Effect.fail(new TranscriptionError({ code: "SubmissionUncertain", message: "Another run reserved this submission. Resume after it saves a job ID; no duplicate POST was sent." }));
      const form = new FormData();
      form.append("media", new Blob([demo.bytes], { type: "audio/flac" }), basename(demo.config.inputPath));
      form.append("options", JSON.stringify({ transcriber: demo.config.transcriber, language: demo.config.language, metadata }));
      const submitted = yield* requestJson(demo, options.token, fetch, "/jobs", { method: "POST", body: form }, demo.config.requestTimeoutMs).pipe(
        Effect.catch((error) => Effect.gen(function* () {
          yield* writeJson(join(directory, "submission-uncertain.json"), { state: "uncertain", signature: demo.signature, recordedAt: new Date().toISOString(), errorCode: error.code });
          return yield* Effect.fail(new TranscriptionError({ code: "SubmissionUncertain", message: "The submission did not return a usable response. Rev may already be processing it. Reconcile the job before retrying; the POST will not be repeated automatically." }));
        })),
      );
      const accepted = yield* Schema.decodeUnknownEffect(Schema.Struct({ id: JobId }))(submitted.value).pipe(
        Effect.mapError(() => new TranscriptionError({ code: "SubmissionUncertain", message: "Rev accepted a request but did not provide a usable job ID. Reconcile the saved submission before retrying." })),
      );
      jobId = accepted.id;
      // Save the ID before validating the rest of the response or starting polling.
      yield* writeJson(jobPath, { signature: demo.signature, id: jobId, receivedAt: new Date().toISOString(), raw: submitted.value });
    }
    const cachedTranscript = yield* readJson(join(directory, "transcript.raw.json"), demo.config.maxResponseBytes);
    if (cachedTranscript) {
      const savedStatus = yield* readJson(statusPath, demo.config.maxResponseBytes);
      const status = yield* decodeJob(savedStatus?.value, jobId, metadata);
      if (status.status !== "transcribed") return yield* Effect.fail(new TranscriptionError({ code: "ArtifactMismatch", message: "Cached transcript has no matching completed job status." }));
      return yield* saveNormalizedTranscript(demo, jobId, cachedTranscript, { method: "api", durationSeconds: status.duration_seconds ?? null });
    }
    const deadline = Date.now() + demo.config.pollTimeoutMs;
    while (Date.now() < deadline) {
      const raw = yield* requestJson(demo, options.token, fetch, `/jobs/${jobId}`, { method: "GET" }, Math.max(1, Math.min(demo.config.requestTimeoutMs, deadline - Date.now())));
      yield* writeJson(statusPath, raw.value);
      const status = yield* decodeJob(raw.value, jobId, metadata);
      if (status.status === "failed") return yield* Effect.fail(new TranscriptionError({ code: "JobFailed", message: `Rev job ${jobId} failed. Its raw status is saved. This demo does not resubmit failed jobs.` }));
      if (status.status === "transcribed") {
        const transcript = yield* requestJson(demo, options.token, fetch, `/jobs/${jobId}/transcript`, { method: "GET" }, demo.config.requestTimeoutMs);
        return yield* saveNormalizedTranscript(demo, jobId, transcript, { method: "api", durationSeconds: status.duration_seconds ?? null });
      }
      yield* Effect.sleep(Math.min(demo.config.pollIntervalMs, Math.max(0, deadline - Date.now())));
    }
    return yield* Effect.fail(new TranscriptionError({ code: "PollTimedOut", message: `Polling stopped at the configured deadline. Job ${jobId} is saved; rerun this command to resume without another POST.` }));
  });
}
