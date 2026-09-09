#!/usr/bin/env python3
"""Independent, read-only acceptance check for this book's completed paired split.

Only the requested new verification evidence file is written. PCM is streamed in
1 MiB blocks into SHA-256; the complete decoded book is never held in memory.
"""

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
from datetime import datetime, timezone
from fractions import Fraction


class VerificationFailure(Exception):
    pass


def require(condition, message):
    if not condition:
        raise VerificationFailure(message)


def file_identity(path):
    digest = hashlib.sha256()
    count = 0
    with path.open("rb") as stream:
        before = os.fstat(stream.fileno())
        while block := stream.read(1024 * 1024):
            digest.update(block)
            count += len(block)
        after = os.fstat(stream.fileno())
    require(
        (before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns)
        == (after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns),
        f"File changed during hashing: {path}",
    )
    require(count == after.st_size, f"Short file read: {path}")
    return {"path": str(path), "byteLength": count, "sha256": digest.hexdigest()}


def unique_keys(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, f"Duplicate JSON key: {key}")
        result[key] = value
    return result


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=unique_keys)


def local_output(root, relative_path):
    require(not Path(relative_path).is_absolute(), "Output inventory contains an absolute path")
    resolved = (root / relative_path).resolve()
    require(resolved.is_relative_to(root), f"Output escapes the split directory: {relative_path}")
    require(resolved.is_file(), f"Missing output file: {resolved}")
    return resolved


def render_text(elements):
    # The normalized transcript separates provider monologues with a newline.
    result = []
    previous = None
    for element in elements:
        current = element["id"].split(":")[0]
        if previous is not None and current != previous:
            result.append("\n")
        result.append(element["value"])
        previous = current
    return "".join(result)


def display_duration(samples, sample_rate):
    milliseconds = math.floor(samples / sample_rate * 1000 + 0.5)
    hours, remainder = divmod(milliseconds, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    seconds, millis = divmod(remainder, 1000)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d}.{millis:03d}"


def tool_version(executable):
    run = subprocess.run([executable, "-version"], capture_output=True, text=True, timeout=30, check=True)
    return run.stdout.splitlines()[0]


def probe_audio(executable, path):
    args = [
        executable, "-v", "error", "-show_entries",
        "stream=index,codec_name,codec_type,sample_rate,channels,bits_per_raw_sample,duration_ts,time_base",
        "-of", "json", str(path),
    ]
    run = subprocess.run(args, capture_output=True, text=True, timeout=30, check=True)
    return json.loads(run.stdout)["streams"]


def decode_pcm(executable, path, stream_index, timeout_seconds, maximum_bytes, aggregate=None):
    args = [
        executable, "-hide_banner", "-nostdin", "-nostats", "-v", "error", "-xerror",
        "-protocol_whitelist", "file", "-i", str(path), "-map", f"0:{stream_index}",
        "-vn", "-sn", "-dn", "-c:a", "pcm_s24le", "-f", "s24le", "pipe:1",
    ]
    digest = hashlib.sha256()
    count = 0
    timed_out = threading.Event()
    started = time.monotonic()
    with tempfile.TemporaryFile() as errors:
        process = subprocess.Popen(args, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=errors)

        def stop():
            timed_out.set()
            process.kill()

        timer = threading.Timer(timeout_seconds, stop)
        timer.daemon = True
        timer.start()
        try:
            require(process.stdout is not None, "FFmpeg stdout was not piped")
            while block := process.stdout.read(1024 * 1024):
                count += len(block)
                require(count <= maximum_bytes, f"Decoded PCM exceeds planned sample count: {path}")
                digest.update(block)
                if aggregate is not None:
                    aggregate.update(block)
            exit_code = process.wait()
            require(not timed_out.is_set(), f"FFmpeg decode timed out: {path}")
            errors.seek(0)
            detail = errors.read(8192).decode("utf-8", errors="replace")
            require(exit_code == 0, f"FFmpeg decode failed ({exit_code}) for {path}: {detail}")
        finally:
            timer.cancel()
            if process.poll() is None:
                process.kill()
                process.wait()
            if process.stdout is not None:
                process.stdout.close()
    return {
        "byteLength": count,
        "sha256": digest.hexdigest(),
        "elapsedSeconds": round(time.monotonic() - started, 3),
        "executable": executable,
        "arguments": args[1:],
    }


def manifest_checksums(manifests, node):
    # The producer's checksum format is JSON.stringify(value, null, 2) + LF.
    # Use only Node's standard JSON/hash functions, not project code, to avoid
    # differences in numeric or Unicode serialization between Python and JS.
    program = """
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const hash = x => createHash('sha256').update(JSON.stringify(x, null, 2) + '\\n').digest('hex');
const records = JSON.parse(readFileSync(0, 'utf8'));
process.stdout.write(JSON.stringify(records.map(m => {
  const { manifestSha256, ...record } = m;
  return { identitySha256: hash(m.identity), manifestSha256: hash(record) };
})));
"""
    run = subprocess.run(
        [node, "--input-type=module", "-e", program], input=json.dumps(manifests),
        capture_output=True, text=True, timeout=30, check=True,
    )
    return json.loads(run.stdout)


def verify(args, evidence):
    plan_path = args.plan.resolve()
    output_dir = args.output_directory.resolve()
    plan_dir = plan_path.parent
    plan = read_json(plan_path)
    require(plan["kind"] == "story-split-plan", "Unexpected split plan kind")
    expected_segments = args.expected_stories + args.expected_extras
    require(len(plan["segments"]) == expected_segments, f"Expected {expected_segments} planned segments")
    plan_hash = file_identity(plan_path)["sha256"]
    source_path = (plan_dir / plan["source"]["path"]).resolve()
    transcript_path = (plan_dir / plan["transcript"]["path"]).resolve()
    raw_path = args.raw_transcript.resolve()
    source = file_identity(source_path)
    transcript_identity = file_identity(transcript_path)
    raw_identity = file_identity(raw_path)
    require(source["sha256"] == plan["source"]["sha256"], "Source hash differs from plan")
    require(source["byteLength"] == plan["source"]["byteLength"], "Source size differs from plan")
    require(transcript_identity["sha256"] == plan["transcript"]["sha256"], "Transcript hash differs from plan")
    require(raw_identity["sha256"] == plan["transcript"]["providerRawSha256"], "Raw transcript hash differs from plan")
    original = read_json(transcript_path)
    require(original["provider"]["jobId"] == plan["transcript"]["providerJobId"], "Provider job differs")
    require(original["provider"]["rawSha256"] == raw_identity["sha256"], "Transcript raw identity differs")
    require(original["source"]["sha256"] == source["sha256"], "Transcript source identity differs")
    sample_rate = plan["source"]["sampleRateHz"]
    channels = original["source"]["audio"]["channels"]
    require(sample_rate == args.expected_sample_rate and channels == args.expected_channels, "Unexpected source sample rate or channels")
    originals = [file_identity(plan_path), source, transcript_identity, raw_identity]
    evidence_references = []
    for reference in plan["evidence"]:
        path = (plan_dir / reference["path"]).resolve()
        identity = file_identity(path)
        require(identity["sha256"] == reference["sha256"], f"Changed source evidence: {path}")
        originals.append(identity)
        evidence_references.append({**reference, "path": str(path)})
    evidence["inputsBefore"] = originals
    evidence["tools"] = {"ffmpeg": tool_version(args.ffmpeg), "ffprobe": tool_version(args.ffprobe)}

    inventory_path = output_dir / "inventory.json"
    inventory = read_json(inventory_path)
    require(inventory["kind"] == "verified-story-inventory" and inventory["status"] == "complete", "Inventory is not complete")
    for field, expected in {
        "bookTitle": plan["bookTitle"], "planSha256": plan_hash,
        "transcriptSha256": transcript_identity["sha256"], "sourceSha256": source["sha256"],
        "providerJobId": plan["transcript"]["providerJobId"], "storyCount": args.expected_stories, "extraCount": args.expected_extras,
    }.items():
        require(inventory[field] == expected, f"Inventory identity mismatch: {field}")
    entries = inventory["stories"] + inventory["extras"]
    require(len(entries) == expected_segments and len({entry["id"] for entry in entries}) == expected_segments, "Inventory does not contain the expected distinct entries")
    by_id = {entry["id"]: entry for entry in entries}
    require(set(by_id) == {segment["id"] for segment in plan["segments"]}, "Inventory IDs differ from plan")
    for kind, field in [("story", "stories"), ("extra", "extras")]:
        expected = [segment["id"] for segment in plan["segments"] if (segment["kind"] == "story") == (kind == "story")]
        require([entry["id"] for entry in inventory[field]] == expected, f"Inventory {field} order differs from plan")

    run_path = output_dir / "run-manifest.json"
    run = read_json(run_path)
    require(run["kind"] == "story-split-identity", "Unexpected run manifest kind")
    require(run["artifactDirectory"] == str(output_dir), "Run manifest output directory differs")
    require(run["plan"] == {"path": str(plan_path), "sha256": plan_hash}, "Run manifest plan identity differs")
    require(run["source"] == {**plan["source"], "path": str(source_path)}, "Run manifest source differs")
    require(run["transcript"] == {**plan["transcript"], "path": str(transcript_path)}, "Run manifest transcript differs")
    require(run["evidence"] == evidence_references, "Run manifest evidence differs")
    retained_plan = output_dir / "plan.raw.json"
    require(retained_plan.read_bytes() == plan_path.read_bytes(), "Retained plan is not byte-identical")
    top_outputs = [file_identity(path) for path in [inventory_path, output_dir / "inventory.md", run_path, retained_plan]]
    evidence["topLevelOutputs"] = top_outputs

    original_elements = original["elements"]
    reconstructed = []
    segment_records = []
    manifests = []
    observed_paths = set()
    next_element = 0
    next_sample = 0
    added_keys = {"bookElementIndex", "approximateSegmentStartSeconds", "approximateSegmentEndSeconds"}
    require(all(not added_keys.intersection(element) for element in original_elements), "Original elements already contain segment-only fields")
    for segment in plan["segments"]:
        name = segment["id"]
        entry = by_id[name]
        require(segment["elementStartIndex"] == next_element, f"Transcript gap or overlap before {name}")
        require(segment["startSample"] == next_sample, f"Audio gap or overlap before {name}")
        next_element = segment["elementEndIndexExclusive"]
        next_sample = segment["endSample"]
        sample_count = segment["endSample"] - segment["startSample"]
        require(sample_count > 0, f"Empty/reversed audio segment: {name}")
        for field in ["id", "title", "kind"]:
            require(entry[field] == segment[field], f"Inventory {field} differs for {name}")
        require(entry["sampleRateHz"] == sample_rate and entry["sampleCount"] == sample_count, f"Inventory sample count/rate differs for {name}")
        require(entry["durationSeconds"] == sample_count / sample_rate, f"Inventory duration differs for {name}")
        require(entry["durationDisplay"] == display_duration(sample_count, sample_rate), f"Inventory display duration differs for {name}")
        paths = {}
        identities = {}
        for label, path_field, hash_field in [
            ("audio", "audioPath", "audioSha256"), ("manifest", "audioManifestPath", "audioManifestSha256"),
            ("transcript", "transcriptPath", "transcriptSha256"), ("text", "textPath", "textSha256"),
        ]:
            path = local_output(output_dir, entry[path_field])
            require(path not in observed_paths, f"Output path reused by more than one entry: {path}")
            observed_paths.add(path)
            identity = file_identity(path)
            require(identity["sha256"] == entry[hash_field], f"Inventory hash differs for {path}")
            paths[label] = path
            identities[label] = identity
        paired = read_json(paths["transcript"])
        require(paired["kind"] == "paired-story-segment-transcript", f"Unexpected paired transcript kind: {name}")
        require(paired["segment"] == segment, f"Paired transcript segment differs: {name}")
        provenance = {
            "planSha256": plan_hash, "transcriptSha256": transcript_identity["sha256"],
            "providerJobId": plan["transcript"]["providerJobId"],
            "providerRawSha256": raw_identity["sha256"], "sourceSha256": source["sha256"],
            "evidence": evidence_references,
        }
        require(paired["provenance"] == provenance, f"Paired provenance differs: {name}")
        require(all(paired["timing"][key] == value for key, value in plan["timing"].items()), f"Paired timing basis differs: {name}")
        selected = original_elements[segment["elementStartIndex"]:segment["elementEndIndexExclusive"]]
        require(len(paired["elements"]) == len(selected), f"Element count differs: {name}")
        clean = []
        for local_index, (actual, expected) in enumerate(zip(paired["elements"], selected)):
            require(actual["bookElementIndex"] == segment["elementStartIndex"] + local_index, f"Book element position differs: {name}")
            if expected["kind"] == "word":
                start = expected["providerStartSeconds"] + plan["timing"]["providerToDecodedOffsetSeconds"] - segment["startSample"] / sample_rate
                end = expected["providerEndSeconds"] + plan["timing"]["providerToDecodedOffsetSeconds"] - segment["startSample"] / sample_rate
                require(actual["approximateSegmentStartSeconds"] == start and actual["approximateSegmentEndSeconds"] == end, f"Segment word times differ: {expected['id']}")
            else:
                require("approximateSegmentStartSeconds" not in actual and "approximateSegmentEndSeconds" not in actual, f"Punctuation acquired timestamps: {expected['id']}")
            restored = {key: value for key, value in actual.items() if key not in added_keys}
            require(restored == expected, f"Original element changed: {expected['id']}")
            clean.append(restored)
        reconstructed.extend(clean)
        count_words = sum(element["kind"] == "word" for element in clean)
        require(entry["wordCount"] == paired["wordCount"] == count_words, f"Word count differs: {name}")
        text = render_text(clean)
        require(paired["text"] == text, f"Paired plain text differs: {name}")
        require(paths["text"].read_bytes() == (text + "\n").encode("utf-8"), f"Text file differs: {name}")

        manifest = read_json(paths["manifest"])
        manifests.append(manifest)
        require(manifest["kind"] == "verified-story-audio", f"Unexpected audio manifest kind: {name}")
        identity_source = manifest["identity"]["source"]
        require(identity_source["sha256"] == source["sha256"] and identity_source["byteLength"] == source["byteLength"], f"Audio source identity differs: {name}")
        require(Path(identity_source["realPath"]).resolve() == source_path, f"Audio source path differs: {name}")
        require(identity_source["audioStreamIndex"] == plan["source"]["audioStreamIndex"], f"Audio source stream differs: {name}")
        request = manifest["identity"]["request"]
        require(request["interval"] == {"clock": plan["timing"]["clock"], "startSample": segment["startSample"], "endSample": segment["endSample"]}, f"Audio interval differs: {name}")
        require(request["expectedSource"] == {"sha256": source["sha256"], "byteLength": source["byteLength"]}, f"Audio request source differs: {name}")
        output = manifest["output"]
        for field, expected in {
            "sha256": identities["audio"]["sha256"], "byteLength": identities["audio"]["byteLength"],
            "codec": "flac", "bitsPerSample": 24, "sampleRateHz": sample_rate,
            "channels": channels, "sampleCount": sample_count,
        }.items():
            require(output[field] == expected, f"Audio manifest output {field} differs: {name}")
        paired_audio = paired["audio"]
        require((paths["transcript"].parent / paired_audio["path"]).resolve() == paths["audio"], f"Paired audio path differs: {name}")
        require((paths["transcript"].parent / paired_audio["manifestPath"]).resolve() == paths["manifest"], f"Paired manifest path differs: {name}")
        for field, expected in {
            "sha256": identities["audio"]["sha256"], "manifestSha256": identities["manifest"]["sha256"],
            "sampleCount": sample_count, "sampleRateHz": sample_rate, "channels": channels,
            "durationSeconds": sample_count / sample_rate,
        }.items():
            require(paired_audio[field] == expected, f"Paired audio {field} differs: {name}")
        streams = probe_audio(args.ffprobe, paths["audio"])
        require(len(streams) == 1, f"Output must contain exactly one stream: {name}")
        stream = streams[0]
        require(stream["index"] == 0 and stream["codec_type"] == "audio" and stream["codec_name"] == "flac", f"Unexpected output codec/stream: {name}")
        require(int(stream["sample_rate"]) == sample_rate and stream["channels"] == channels and int(stream["bits_per_raw_sample"]) == 24, f"Output audio format differs: {name}")
        probed_samples = int(stream["duration_ts"]) * Fraction(stream["time_base"]) * sample_rate
        require(probed_samples == sample_count, f"FFprobe sample count differs: {name}")
        record = {
            "id": name, "title": entry["title"], "kind": entry["kind"],
            "startSample": segment["startSample"], "endSample": segment["endSample"],
            "sampleCount": sample_count, "sampleRateHz": sample_rate, "channels": channels,
            "durationSeconds": sample_count / sample_rate, "durationDisplay": entry["durationDisplay"],
            "elementCount": len(clean), "wordCount": count_words,
            "files": identities, "ffprobeSampleCount": int(probed_samples),
            "manifestDecodedPcmSha256": output["decodedPcmSha256"],
        }
        segment_records.append(record)
        print(f"Artifact checks passed: {name}", flush=True)

    require(next_element == len(original_elements), "Plan omits final transcript elements")
    require(reconstructed == original_elements, "Reconstructed transcript elements differ")
    require(render_text(reconstructed) == original["text"], "Reconstructed whole-book text differs")
    require(sum(record["wordCount"] for record in segment_records) == original["wordCount"], "Reconstructed word count differs")
    checksums = manifest_checksums(manifests, args.node)
    for manifest, expected in zip(manifests, checksums):
        require(manifest["identitySha256"] == expected["identitySha256"], "Audio manifest identity checksum differs")
        require(manifest["manifestSha256"] == expected["manifestSha256"], "Audio manifest self-checksum differs")
    require(inventory["checks"]["assignedElementCount"] == len(original_elements), "Inventory element-count claim differs")
    require(inventory["checks"]["assignedWordCount"] == original["wordCount"], "Inventory word-count claim differs")
    evidence["segments"] = segment_records
    evidence["transcriptReconstruction"] = {
        "exactElementEquality": True, "exactWholeBookTextEquality": True,
        "elementCount": len(reconstructed), "wordCount": original["wordCount"],
        "removedFieldsOnly": sorted(added_keys),
        "scope": "Every original element field, value, ID, confidence and provider timestamp is retained in order.",
    }

    print("Artifact and exact transcript checks passed. Streaming original-book PCM...", flush=True)
    require(next_sample == args.expected_source_samples, "Plan endpoint differs from independently measured decoded sample count")
    expected_bytes = next_sample * channels * 3
    source_pcm = decode_pcm(args.ffmpeg, source_path, plan["source"]["audioStreamIndex"], args.decode_timeout_seconds, expected_bytes)
    require(source_pcm["byteLength"] == expected_bytes, "Decoded source endpoint differs from split plan")
    evidence["sourceDecodedPcm"] = source_pcm
    aggregate = hashlib.sha256()
    concatenated_bytes = 0
    for index, record in enumerate(segment_records):
        name = record["id"]
        print(f"Streaming FLAC {index + 1}/{expected_segments}: {name}", flush=True)
        decoded = decode_pcm(
            args.ffmpeg, Path(record["files"]["audio"]["path"]), 0,
            args.decode_timeout_seconds, record["sampleCount"] * channels * 3, aggregate,
        )
        require(decoded["byteLength"] == record["sampleCount"] * channels * 3, f"Decoded output sample count differs: {name}")
        require(decoded["sha256"] == record["manifestDecodedPcmSha256"], f"Decoded output PCM hash differs from manifest: {name}")
        record["independentDecodedPcm"] = decoded
        concatenated_bytes += decoded["byteLength"]
    aggregate_hash = aggregate.hexdigest()
    require(concatenated_bytes == source_pcm["byteLength"], "Concatenated PCM byte count differs from original")
    require(aggregate_hash == source_pcm["sha256"], "Concatenated PCM SHA-256 differs from original")
    evidence["audioReconstruction"] = {
        "exactDecoded24BitPcmMatch": True, "segmentOrder": [record["id"] for record in segment_records],
        "byteLength": concatenated_bytes, "sha256": aggregate_hash,
        "sampleCountPerChannel": next_sample, "sampleRateHz": sample_rate, "channels": channels,
        "decodedFormat": "s24le", "memoryBlockBytes": 1024 * 1024,
        "scope": "Concatenating every output in plan order reproduces the original FFmpeg decode converted to 24-bit PCM, proving no missing, duplicated or reordered decoded samples across the complete partition. This does not claim forced alignment of provider word timestamps.",
    }

    # Rehash all pinned inputs and all outputs after the long decodes. No existing
    # input, source evidence, transcript, manifest or audio file is rewritten.
    for original_identity in originals:
        require(file_identity(Path(original_identity["path"])) == original_identity, f"Input changed during verification: {original_identity['path']}")
    for output_identity in top_outputs + [identity for record in segment_records for identity in record["files"].values()]:
        require(file_identity(Path(output_identity["path"])) == output_identity, f"Output changed during verification: {output_identity['path']}")
    evidence["inputAndOutputHashesUnchangedAtEnd"] = True
    evidence["storyDurationsShortestFirst"] = [
        {key: record[key] for key in ["id", "title", "durationSeconds", "durationDisplay", "sampleCount", "sampleRateHz"]}
        for record in sorted((record for record in segment_records if record["kind"] == "story"), key=lambda record: record["sampleCount"])
    ]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", required=True, type=Path)
    parser.add_argument("--output-directory", required=True, type=Path)
    parser.add_argument("--raw-transcript", required=True, type=Path)
    parser.add_argument("--evidence", required=True, type=Path)
    parser.add_argument("--ffmpeg", required=True)
    parser.add_argument("--ffprobe", required=True)
    parser.add_argument("--node", required=True)
    parser.add_argument("--decode-timeout-seconds", required=True, type=int)
    parser.add_argument("--expected-stories", required=True, type=int)
    parser.add_argument("--expected-extras", required=True, type=int)
    parser.add_argument("--expected-sample-rate", required=True, type=int)
    parser.add_argument("--expected-channels", required=True, type=int)
    parser.add_argument("--expected-source-samples", required=True, type=int)
    args = parser.parse_args()
    require(args.decode_timeout_seconds > 0, "Decode timeout must be positive")
    target = args.evidence.resolve()
    require(not target.exists(), "Verification evidence already exists; supply a new evidence path")
    require(target.parent.is_dir(), "Verification evidence parent directory does not exist")
    evidence = {
        "schemaVersion": 1, "kind": "independent-paired-output-acceptance",
        "startedAt": datetime.now(timezone.utc).isoformat(), "status": "running",
        "planPath": str(args.plan.resolve()), "outputDirectory": str(args.output_directory.resolve()),
        "verificationScript": file_identity(Path(__file__).resolve()),
        "method": "Independent Python checks plus standard ffprobe, FFmpeg and Node JSON/hash functions; no application verification functions, source metadata boundaries or legacy cut times are used.",
    }
    code = 0
    try:
        verify(args, evidence)
        evidence["status"] = "passed"
    except Exception as error:
        code = 1
        evidence["status"] = "failed"
        evidence["failure"] = {"type": type(error).__name__, "message": str(error)}
        print(f"Verification failed: {error}", file=sys.stderr, flush=True)
    evidence["completedAt"] = datetime.now(timezone.utc).isoformat()
    with target.open("x", encoding="utf-8") as stream:
        json.dump(evidence, stream, indent=2, ensure_ascii=False)
        stream.write("\n")
    print(f"Verification evidence: {target}", flush=True)
    if code == 0:
        print("PASS: exact transcript and decoded PCM reconstruction", flush=True)
        for story in evidence["storyDurationsShortestFirst"]:
            print(f"{story['durationDisplay']}  {story['title']}", flush=True)
    return code


if __name__ == "__main__":
    sys.exit(main())
