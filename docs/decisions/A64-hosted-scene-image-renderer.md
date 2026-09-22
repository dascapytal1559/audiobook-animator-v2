# A64: Scene images are rendered by hosted GPT-5.4 Image 2; local Qwen Image 2.1 is the free fallback.

**Status.** Standing (2026-09-23). Settled by the user after the Understand Act One, Beat One comparison, and applied first to that beat's second and third shots.

**Decision.** A scene image is rendered by `openai/gpt-5.4-image-2` through OpenRouter's `POST /api/v1/images`, at `aspect_ratio` 16:9, `quality` high, `background` opaque, one image per call, with no reference images unless a later decision adds them. Its shots go on the `gpt-5-4-image-2` image track (A60), each record carrying the exact prompt and, in its notes, the returned usage, cost, and dimensions. The local Qwen Image 2.1 experiment is concluded: it is kept only as a free fallback for when a paid call is not wanted, and its shots go on the `qwen-image-2-1` track. The OpenRouter key is read from the user's local auth file at call time and never written into the repository, a record, or a log. Nothing in this repository calls either renderer; a script or agent renders and uploads the result as a shot.

**Evidence.** The comparison pack of 2026-09-22 (`data/animator-v2-scene-compare-pack/report.md` under firstmate, local-only) rendered one fixed prompt for the drowning moment, `understand / beat-01`, through both, with no references, rerolls, crops, or upscales:

| Renderer | Settings | Wall time | Dimensions | Reported cost |
| --- | --- | ---: | --- | ---: |
| Qwen Image 2.1, local MFLUX 0.20.0 on MLX, 8-bit | 40 steps, seed 42, guidance 1.0 | 147.37 s whole process; peak MLX 8.695 GB, footprint 10.134 GB, excluding the 24.0 GB weight download | 1024×576 | $0 API |
| GPT-5.4 Image 2, OpenRouter | 16:9, high, opaque, n=1 | 102.05 s including download | 1536×864 | $0.1316 |

The pack's reading, which the user accepted: the hosted image holds the passage's space (a thick opaque ice ceiling, small blurred people above, an unspecified face), while the local one reads as a thin water surface with oversized cropped figures and an invented detailed face, faults an upscale does not repair. It is one sample, not a leaderboard. The first production render under this decision, Beat One's waking shot on 2026-09-23, measured 91.88 s, 1536×864, and $0.13216 (350 prompt and 4,312 image tokens), so an image costs about $0.13.

**Understand, Act One, Beat One.** The beat is three declared shots (A65) on the `gpt-5-4-image-2` track, each with description takes by `deepseek/deepseek-v4.1-flash`, `openai/gpt-6-astra`, and `anthropic/claude-fable-5.1`. Shot one, the man beneath the ice, is the pack's image anchored to the beat's start, `gpt:w0` (the spoken title, immediately before "A layer of ice"), sample 28067. Shot two, him waking and getting up from the bed, is record `01M3527RYK0G3RF9P3V2VC3GEF`, anchored to `gpt:w74`, "I wake up, screaming", sample 716703 on the auto word timing. Shot three, him sitting awake on the edge of the bed in the hours before dawn, is record `01M353MXM85GS5J2HGKAYNQX03`, anchored to `gpt:w225`, "The same nightmare, again and again", sample 2228343; it measured 88.11 s, 1536×864, and $0.132584 (403 prompt and 4,312 image tokens). The waking shot first hung its takes on a `beat-01-waking` map section; A65 removed it. The `qwen-image-2-1` track keeps its single ice image, anchored to `gpt:w0`.

Shot three's DeepSeek description needed three calls. At `max_tokens` 1500, the first call, routed to CoreWeave, and a second pinned to Together (the provider of the waking take) both spent every completion token on reasoning and returned no text. The third, on Together with `max_tokens` 4000, returned the take. The take's notes record all three.

Recorded in the decision index of [CONTEXT.md](../../CONTEXT.md).
