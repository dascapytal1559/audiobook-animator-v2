import importlib.util
from pathlib import Path
import unittest


def module(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name+'.py'))
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


class StoryTranscriptionTests(unittest.TestCase):
    def test_changed_word_counts_preserve_text_and_clip_bounds(self):
        source = {'audio': {'sampleRateHz':10, 'sampleCount':100, 'sha256':'a'*64}, 'elements': [
            {'kind':'word','value':'Yahweh','approximateSegmentStartSeconds':1,'approximateSegmentEndSeconds':2},
            {'kind':'punctuation','value':'. '},
            {'kind':'word','value':'If','approximateSegmentStartSeconds':5,'approximateSegmentEndSeconds':6},
            {'kind':'punctuation','value':' '},
            {'kind':'word','value':'wrong','approximateSegmentStartSeconds':7,'approximateSegmentEndSeconds':8},
        ]}
        draft = 'Yahweh will neither help nor hinder us. If…\n'
        result = {'elements': module('prepare-story-transcript').seed_elements(source, draft)}
        self.assertEqual(''.join(e['value'] for e in result['elements']), draft)
        words = [e for e in result['elements'] if e['kind']=='word']
        self.assertEqual([e['startSample'] for e in words], sorted(e['startSample'] for e in words))
        self.assertTrue(all(0 <= e['startSample'] < e['endSample'] <= 100 for e in words))
        self.assertEqual(words[0]['startSample'],10)
        self.assertEqual(words[-1]['startSample'],50)

    def test_overlap_is_not_duplicated_and_punctuation_survives(self):
        overlap = 'one two three four five six seven eight nine ten'
        text, joins = module('stitch-story-transcript').stitch([
            {'startSeconds':0,'durationSeconds':250,'result':{'text':'Before. '+overlap+'. clipped'}},
            {'startSeconds':240,'durationSeconds':100,'result':{'text':overlap+'! After.'}},
        ])
        self.assertEqual(text, 'Before. '+overlap+'! After.\n')
        self.assertEqual(len(joins),1)
        self.assertEqual(joins[0]['matchingWords'],10)

    def test_unreliable_join_is_refused(self):
        with self.assertRaises(RuntimeError):
            module('stitch-story-transcript').stitch([
                {'startSeconds':0,'durationSeconds':250,'result':{'text':'Unrelated first section.'}},
                {'startSeconds':240,'durationSeconds':100,'result':{'text':'Different next section.'}},
            ])


if __name__ == '__main__':
    unittest.main()
