"""Prepare a working GPT transcript with explicit timing provenance.

Rev split word positions bootstrap timing once; downstream story work reads GPT only.
"""
import argparse
import difflib
import hashlib
import json
import re
from pathlib import Path


def seed_elements(source, draft):
    pattern = re.compile(r"\w+(?:['’\-]\w+)*")
    rate = source['audio']['sampleRateHz']
    count = source['audio']['sampleCount']
    old = []
    for element in source['elements']:
        if element['kind'] != 'word':
            continue
        tokens = list(pattern.finditer(element['value']))
        start = max(0, round(element['approximateSegmentStartSeconds'] * rate))
        end = min(count, round(element['approximateSegmentEndSeconds'] * rate))
        for i, token in enumerate(tokens):
            old.append((token.group(), round(start + (end-start)*i/len(tokens)), round(start + (end-start)*(i+1)/len(tokens))))
    new = list(pattern.finditer(draft))
    spans = [None] * len(new)
    normalize = lambda text: text.lower().replace('’', "'")
    diff = difflib.SequenceMatcher(None, [normalize(w[0]) for w in old], [normalize(w.group()) for w in new], autojunk=False)
    for op, a, b, c, d in diff.get_opcodes():
        if op == 'equal':
            spans[c:d] = [(w[1], w[2]) for w in old[a:b]]
        elif d > c:
            start = old[a][1] if a < b else (old[a-1][2] if a else 0)
            end = old[b-1][2] if a < b else (old[a][1] if a < len(old) else count)
            if end-start < d-c:
                start = old[max(0, a-1)][1]
                end = old[min(len(old)-1, a)][2]
            spans[c:d] = [(round(start+(end-start)*i/(d-c)), round(start+(end-start)*(i+1)/(d-c))) for i in range(d-c)]
    elements = []
    position = 0
    previous = 0
    for i, (token, span) in enumerate(zip(new, spans)):
        assert span is not None
        if token.start() > position:
            elements.append({'kind':'punctuation', 'value':draft[position:token.start()]})
        start = max(previous, span[0])
        end = min(count, max(start+1, span[1]))
        assert 0 <= start < end <= count
        elements.append({'kind':'word', 'id':f'gpt:w{i}', 'value':token.group(), 'startSample':start, 'endSample':end})
        previous = start
        position = token.end()
    if position < len(draft):
        elements.append({'kind':'punctuation', 'value':draft[position:]})
    assert ''.join(e['value'] for e in elements) == draft
    return elements


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--story', type=Path, required=True)
    parser.add_argument('--seed', type=Path, required=True, help='Rev split transcript JSON used to bootstrap timing')
    parser.add_argument('--text', type=Path, required=True)
    parser.add_argument('--run', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    story = json.loads((args.story/'story.json').read_text())
    source_bytes = args.seed.read_bytes()
    source = json.loads(source_bytes)
    run_bytes = (args.run/'run.json').read_bytes()
    run = json.loads(run_bytes)
    if run['audioSha256'] != story['audioSha256'] or source['audio']['sha256'] != story['audioSha256']:
        raise RuntimeError('Transcription run or timing seed belongs to different audio.')
    draft = args.text.read_text()
    elements = seed_elements(source, draft)
    result = {'schemaVersion':1, 'kind':'story-transcript', 'storyId':story['id'],
              'provider':{'name':'openai', 'model':run['configuration']['model']},
              'audio':{'sha256':story['audioSha256'], 'sampleRateHz':story['sampleRateHz'], 'sampleCount':story['sampleCount'], 'sourceStartSample':source['segment']['startSample']},
              'provenance':{'runPath':str((args.run/'run.json').resolve().relative_to(args.story.resolve())), 'runSha256':hashlib.sha256(run_bytes).hexdigest(), 'bookSourceSha256':story['origin']['sourceSha256']},
              'timing':{'method':'rev-seeded', 'seedTranscriptSha256':hashlib.sha256(source_bytes).hexdigest()},
              'wordCount':sum(e['kind']=='word' for e in elements), 'text':draft, 'elements':elements}
    args.output.write_text(json.dumps(result, indent=2)+'\n')
    print(f'{args.output}: {result["wordCount"]} GPT words; exact text reconstruction verified')
