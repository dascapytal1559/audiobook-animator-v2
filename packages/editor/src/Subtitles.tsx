import { Fragment, useMemo } from "react";
import { layoutSubtitles, subtitleAt, subtitleDefaults, subtitleSentences, timeSubtitles, type StoryResponse, type StoryWord } from "@animator/domain";

type Props = { story: StoryResponse; words: ReadonlyArray<StoryWord>; sample: number; highlightedWordId: string | null };

/** The browser supplies font metrics; sentence/phrase membership and clip-clock visibility are shared pure rules (A61). */
export function Subtitles({ story, words, sample, highlightedWordId }: Props) {
  const cues = useMemo(() => {
    const context = document.createElement("canvas").getContext("2d");
    if (context === null) throw new Error("Subtitle layout requires a canvas text-measurement context.");
    context.font = `${subtitleDefaults.fontWeight} ${subtitleDefaults.fontSize}px ${subtitleDefaults.fontFamily}`;
    return layoutSubtitles(subtitleSentences(story.elements, story.words), text => context.measureText(text).width);
  }, [story.elements, story.words]);
  const timed = useMemo(() => timeSubtitles(cues, words, story.clip), [cues, words, story.clip]);
  const cue = subtitleAt(timed, sample);
  if (cue === null) return null;
  return (
    <div className="preview-subtitles" data-testid="subtitle" data-cue-id={cue.id} style={{
      fontFamily: subtitleDefaults.fontFamily, fontWeight: subtitleDefaults.fontWeight,
      fontSize: `${100 * subtitleDefaults.fontSize / subtitleDefaults.referenceWidth * cue.fontScale}cqw`,
    }}>
      {cue.lines.map((line, index) => (
        <div className="subtitle-line" key={index}>
          {line.map((token, tokenIndex) => (
            <Fragment key={token.wordId}>
              {tokenIndex === 0 ? token.prefix.trimStart() : token.prefix}
              <span data-word-id={token.wordId} className={token.wordId === highlightedWordId ? "subtitle-word active" : "subtitle-word"}>{token.value}</span>
              {tokenIndex === line.length - 1 ? token.suffix.trimEnd() : token.suffix}
            </Fragment>
          ))}
        </div>
      ))}
    </div>
  );
}
