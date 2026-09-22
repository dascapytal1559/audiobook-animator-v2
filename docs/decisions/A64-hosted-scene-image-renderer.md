# A64: Scene images are rendered by hosted GPT-5.4 Image 2; local Qwen Image 2.1 is the free fallback.

**Status.** Standing (2026-09-23). Settled by the user after the Understand Act One, Beat One comparison, and applied first to that beat's second shot.

**Decision.** A scene image is rendered by `openai/gpt-5.4-image-2` through OpenRouter's `POST /api/v1/images`, at `aspect_ratio` 16:9, `quality` high, `background` opaque, one image per call, with no reference images unless a later decision adds them. Its shots go on the `gpt-5-4-image-2` image track (A60), each record carrying the exact prompt and, in its notes, the returned usage, cost, and dimensions. The local Qwen Image 2.1 experiment is concluded: it is kept only as a free fallback for when a paid call is not wanted, and its shots go on the `qwen-image-2-1` track. The OpenRouter key is read from the user's local auth file at call time and never written into the repository, a record, or a log. Nothing in this repository calls either renderer; a script or agent renders and uploads the result as a shot.

**Evidence.** The comparison pack of 2026-09-22 (`data/animator-v2-scene-compare-pack/report.md` under firstmate, local-only) rendered one fixed prompt for the drowning moment, `understand / beat-01`, through both, with no references, rerolls, crops, or upscales:

| Renderer | Settings | Wall time | Dimensions | Reported cost |
| --- | --- | ---: | --- | ---: |
| Qwen Image 2.1, local MFLUX 0.20.0 on MLX, 8-bit | 40 steps, seed 42, guidance 1.0 | 147.37 s whole process; peak MLX 8.695 GB, footprint 10.134 GB, excluding the 24.0 GB weight download | 1024×576 | $0 API |
| GPT-5.4 Image 2, OpenRouter | 16:9, high, opaque, n=1 | 102.05 s including download | 1536×864 | $0.1316 |

The pack's reading, which the user accepted: the hosted image holds the passage's space (a thick opaque ice ceiling, small blurred people above, an unspecified face), while the local one reads as a thin water surface with oversized cropped figures and an invented detailed face, faults an upscale does not repair. It is one sample, not a leaderboard. The first production render under this decision, Beat One's waking shot on 2026-09-23, measured 91.88 s, 1536×864, and $0.13216 (350 prompt and 4,312 image tokens), so an image costs about $0.13.

**Understand, Act One, Beat One.** The beat is two shots on the `gpt-5-4-image-2` track. Shot one, the man beneath the ice, is the pack's image at the beat's start, sample 28067 (`gpt:w0`, the spoken title, immediately before "A layer of ice"). Shot two, him waking and getting up from the bed, starts at `gpt:w74`, "I wake up, screaming", sample 716703 on the auto word timing, and is record `01M3527RYK0G3RF9P3V2VC3GEF`. The story map gained one section for it, `beat-01-waking` (kind scene, `gpt:w74`–`gpt:w276`, inside `beat-01`, whose boundary is unchanged), so the Scenes detail shows the waking image take and its three description takes by `deepseek/deepseek-v4.1-flash`, `openai/gpt-6-astra`, and `anthropic/claude-fable-5.1`; `beat-01` keeps the ice shot's takes. The `qwen-image-2-1` track keeps its single ice image. What follows the waking shot, objects around the room or nothing, is still open.

Recorded in the decision index of [CONTEXT.md](../../CONTEXT.md).
