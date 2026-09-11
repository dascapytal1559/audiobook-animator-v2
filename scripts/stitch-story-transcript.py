"""Join overlapping transcription responses at a shared run of words, saving each join for review."""
import argparse
import difflib
import json
import re
from pathlib import Path


def stitch(parts):
    text = ''
    joins = []
    previous_end = 0
    for part in parts:
        start = part['startSeconds']
        assert start <= previous_end, 'Audio coverage has a gap.'
        previous_end = start + part['durationSeconds']
        incoming = part['result']['text']
        if not text:
            text = incoming
            continue
        left = list(re.finditer(r"\w+(?:['’\-]\w+)*", text))
        right = list(re.finditer(r"\w+(?:['’\-]\w+)*", incoming))
        window = 100
        base = max(0, len(left)-window)
        normalize = lambda token: token.group().lower().replace('’', "'")
        matcher = difflib.SequenceMatcher(None, [normalize(t) for t in left[base:]], [normalize(t) for t in right[:window]], autojunk=False)
        match = max(matcher.get_matching_blocks(), key=lambda m: m.size)
        if match.size < 8:
            raise RuntimeError(f'No reliable overlap at {start}s; manual join needed.')
        a = base + match.a + match.size - 1
        b = match.b + match.size - 1
        joins.append({'startSeconds':start, 'matchingWords':match.size,
                      'sharedText':incoming[right[match.b].start():right[b].end()],
                      'discardedPreviousTail':text[left[a].end():],
                      'discardedIncomingPrefix':incoming[:right[match.b].start()]})
        text = text[:left[a].end()] + incoming[right[b].end():]
    return text+'\n', joins


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', type=Path, required=True)
    parser.add_argument('--story', type=Path, required=True)
    args = parser.parse_args()
    parts = [json.loads(p.read_text()) for p in sorted(args.directory.glob('transcription-*.json'))]
    manifest = json.loads((args.story/'story.json').read_text())
    run = json.loads((args.directory/'run.json').read_text())
    configuration = run['configuration']
    stride = configuration['chunkSeconds']
    duration = manifest['durationSeconds']
    expected = int((duration-1e-9)//stride)+1
    if run['audioSha256'] != manifest['audioSha256'] or len(parts) != expected:
        raise RuntimeError('Transcription is incomplete or belongs to another story audio.')
    for i, part in enumerate(parts):
        if (part['startSeconds'] != i*stride or part['durationSeconds'] != min(stride+configuration['overlapSeconds'], duration-i*stride)
                or part['model'] != configuration['model']):
            raise RuntimeError(f'Unexpected transcription chunk identity at {i}.')
    text, joins = stitch(parts)
    (args.directory/'transcript.txt').write_text(text)
    (args.directory/'joins.json').write_text(json.dumps(joins, indent=2)+'\n')
    print(f'{len(parts)} sections, {len(joins)} verified overlaps, {len(text.split())} words.')
