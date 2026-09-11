"""Transcribe story audio with an explicit OpenAI configuration; preserve every raw response.

Reads OPENAI_API_KEY from the process environment or the repository .env. Never reads adjacent projects.
"""
import argparse
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import subprocess
import urllib.error
import urllib.request
import uuid


def transcribe(audio, config, key):
    boundary = uuid.uuid4().hex
    fields = [('model', config['model'])]
    fields += [('languages[]', x) for x in config['languages']]
    fields += [('keywords[]', x) for x in config['keywords']]
    body = bytearray()
    for name, value in fields:
        body.extend(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode())
    body.extend(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.mp3"\r\nContent-Type: audio/mpeg\r\n\r\n'.encode())
    body.extend(audio.read_bytes())
    body.extend(f'\r\n--{boundary}--\r\n'.encode())
    request = urllib.request.Request('https://api.openai.com/v1/audio/transcriptions', data=body,
        headers={'Authorization': 'Bearer '+key, 'Content-Type': 'multipart/form-data; boundary='+boundary})
    try:
        with urllib.request.urlopen(request, timeout=config['timeoutSeconds']) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        # API messages only, never headers or credentials.
        payload = json.loads(error.read())
        raise RuntimeError(f"OpenAI HTTP {error.code}: {payload.get('error', {}).get('message', 'Request failed')}") from None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--story', type=Path, required=True)
    parser.add_argument('--run', type=Path, required=True, help='JSON run file; its schema and defaults are TranscriptionSettings in src/modules/story-transcription/contracts.ts')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    config = json.loads(args.run.read_text())
    key = os.environ.get('OPENAI_API_KEY')
    if not key:
        env = Path(__file__).resolve().parents[1]/'.env'
        if env.exists():
            for line in env.read_text().splitlines():
                name, _, value = line.partition('=')
                if name.strip() == 'OPENAI_API_KEY':
                    key = value.strip().strip('\"\'')
    if not key:
        raise RuntimeError('Set OPENAI_API_KEY in the environment or repository .env.')
    manifest = json.loads((args.story/'story.json').read_text())
    source = args.story/manifest['audioPath']
    if hashlib.sha256(source.read_bytes()).hexdigest() != manifest['audioSha256']:
        raise RuntimeError('Source audio hash differs from story manifest.')
    identity = {'audioSha256': manifest['audioSha256'], 'configuration': config}
    args.output.mkdir(parents=True, exist_ok=True)
    run_path = args.output/'run.json'
    if run_path.exists() and json.loads(run_path.read_text()) != identity:
        raise RuntimeError('Output directory belongs to another audio/configuration. Choose a new output directory.')
    run_path.write_text(json.dumps(identity, indent=2)+'\n')
    stride = config['chunkSeconds']
    assert stride > 0 and 0 <= config['overlapSeconds'] < stride and config['concurrency'] > 0
    duration = manifest['durationSeconds']
    count = int((duration-1e-9)//stride)+1

    def run(index):
        start = index*stride
        length = min(stride+config['overlapSeconds'], duration-start)
        destination = args.output/f'transcription-{index:02}.json'
        if destination.exists():
            saved = json.loads(destination.read_text())
            assert saved['startSeconds'] == start and saved['durationSeconds'] == length
            assert isinstance(saved['result']['text'], str) and saved['result']['text'].strip()
            return
        audio = args.output/f'audio-{index:02}.mp3'
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', str(start), '-i', str(source), '-t', str(length),
                        '-ar', str(config['sampleRateHz']), '-ac', '1', '-c:a', 'libmp3lame', '-b:a', config['bitrate'], str(audio)], check=True)
        result = transcribe(audio, config, key)
        if not isinstance(result.get('text'), str) or not result['text'].strip():
            raise RuntimeError(f'Chunk {index} has no transcript text.')
        destination.write_text(json.dumps({'model': config['model'], 'startSeconds': start, 'durationSeconds': length, 'result': result}, indent=2)+'\n')
        print(f'Completed {index+1}/{count}: {len(result["text"])} characters', flush=True)

    # Establish model/key access before scheduling the remainder.
    run(0)
    with concurrent.futures.ThreadPoolExecutor(max_workers=config['concurrency']) as pool:
        list(pool.map(run, range(1, count)))
    print(f'Complete: {count} overlapping audio sections.', flush=True)


if __name__ == '__main__':
    main()
