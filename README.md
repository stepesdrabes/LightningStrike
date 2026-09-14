# LightningStrike

Music-driven lighting for a room, with a 3D preview and matching output to real fixtures.
The room has a 720-pixel ceiling frame and a one-pixel Bounce Lamp. Local audio analysis
finds the musical grid; a deterministic engine composes the show. An evening file scripts a
whole night around it: songs, pauses, light moments, transitions and custom effects.

The preview and hardware use the same renderer and encoded pixels. Hardware output runs
in Node over DDP or sACN; the browser supplies the audio playback position.

## Use it

- Search YouTube Music, paste a supported URL, or paste a local audio path.
- Queue tracks, reorder them, or let radio keep the queue supplied.
- Watch the room preview, inspect the arrangement, and configure hardware in the app.
- Use Lounge for ambient lighting over music. When playback stops, the room fades into
  ambient scenes; stale browser sync also lets the hardware return to ambient.
- Open an evening from the right-hand rail, rehearse it, then run the night from there.
- Share the queue's QR code so guests can add tracks from their phones and withdraw their
  own unplayed additions. Queue management, authoring and hardware controls stay with the host.

Space toggles playback; arrows seek, with Shift for larger jumps. Cmd/Ctrl-K opens search,
`[` and `]` toggle the side panels, and `L` toggles Lounge.

## Evenings

An evening is a TypeScript file whose default export is `evening(...)` from
`lightningstrike`; keep them in `evenings/`, where `npm run check` type-checks them.
[evenings/light-before-thunder.ts](evenings/light-before-thunder.ts) is a full example.

- `block` plays named songs and `fill` slots chosen by genre, heat, tempo and length;
  `pause` is silence or calm music under a look; `hold` waits for Go; `moment` is a silent
  light moment on its own clock; `narration` plays your own audio under a timeline. Timeline
  steps change looks and sections, fire hits, and place kicks off the grid, like a racing heart.
- A block's `palette` tints its songs toward the chapter's colours without changing the light
  they deliver, and a look laid over songs still rises and falls with their sections: the
  evening sets the colour, each song keeps its intensity.
- `enter` sets how the room hands over: a sting in a gap, a dissolve or a cut, a hit on the
  first downbeat, or an audio crossfade. `at` and `notBefore` anchor segments to the clock;
  fills with a target length stretch or shrink to meet them.
- `effect({ create(g) })` is your own effect, run through the same sandbox and gate as built-in
  ones. Only the effect vocabulary and its own locals exist inside `create`. `look` stacks
  effects with a palette, intensity, motion and `floor`, the house light under them.

The loader runs the file in a worker with a time and memory limit; it may import only
`lightningstrike` and its own relative modules. The worker contains mistakes, not hostile code:
open only evening files you trust. Findings point at file lines. **Prepare** fetches and
analyses the songs the evening names, **Rehearse** plays it exactly as the night, hardware
included, and can be moved to any moment, and **Start** sets the current queue aside until the
evening ends. While it runs, segments are queue rows: skip a segment either way, hold after
the current one, or bail out and keep the music. Guests' requests wait for the blocks that take
them; a song you play now plays straight away and the evening carries on after it. After a
restart the evening comes back where it was, paused.

## Run locally

Use Node 22+ and put `ffmpeg`, `ffprobe` and `yt-dlp` on PATH.

```sh
npm install
npm run dev
```

Open [localhost:5180](http://localhost:5180). The development server also listens on the
LAN for guest access. The app is the product interface; there is no separate playback CLI.

## Build and check

Run commands from the repository root:

```sh
npm test                            # Vitest
npm run check                       # packages, web and controller
npm run build                       # production web build
npm run build -w @mv/desktop         # desktop application and installers
npm run dev -w @mv/controller        # lights controller, localhost:5181
npm run build -w @mv/controller      # static controller build
```

Desktop builds require Rust and the platform's Tauri build prerequisites. The build hook
builds the web server and assembles its Node 24.11.0 sidecar automatically, pinned in
`apps/desktop/scripts/bundle-support.js`. To prepare desktop
development separately, run `npm run bundle -w @mv/desktop`, then
`npm run dev -w @mv/desktop`. The desktop app still expects the audio tools on PATH.
The bundled native runtimes require macOS 14 or newer. Build on Apple Silicon for a native
ARM64 application; the drum pipeline runs locally on CPU without Python or an NVIDIA GPU.

## How it works

Ingest downloads or copies audio, decodes it with ffmpeg, and produces a `TrackAnalysis`:
beats, bars, sections, spectral features and musical events. Optional metadata, lyrics and
audio models refine the result. The engine turns that analysis into a bar-addressed `Show`;
the linter checks the show before playback. AI authors use the same contracts and effect gate.

The queue is server state, persisted between runs and observed by clients over SSE. Track
preparation is serialized, prioritizing the current track and the next one. The server
renders hardware frames from the show and browser sync instead of receiving pixel streams
from the browser.

## Repository

| Path | Responsibility |
| --- | --- |
| `apps/web` | SvelteKit player, guest queue and server APIs |
| `apps/desktop` | Tauri window and Node server sidecar |
| `apps/controller` | Standalone web controls for the lights' HTTP API |
| `packages/core` | Contracts, grid, colour, effects/sandbox, mixing and byte encoding |
| `packages/analysis` | Audio ingest, DSP, optional models and enrichment |
| `packages/author-engine` | Deterministic show composition and linting |
| `packages/author-ai` | AI authoring, tools and effect catalog |
| `packages/preview3d` | three.js room preview |
| `packages/transport` | DDP and sACN output |
| `firmware` | Frame, bench fixture and Bounce Lamp firmware |
| `bench` | Measurement, corpus and model-export tools |

Workspace packages are consumed as TypeScript source. `core` has no external runtime
dependencies, so the same renderer runs in the browser and Node. See [CLAUDE.md](CLAUDE.md)
for development conventions and the rules for changing effects or cached contracts.

The [lighting and drum review harnesses](bench/POLISH.md) provide audio-synchronized output
comparisons, isolated-effect probes and corpus checks without replacing saved shows.

## Cache and models

Workspace runs use the repository's `cache/`, independent of the working directory.
`MV_CACHE_DIR` overrides it. Desktop defaults to its application-local cache directory and
also honors `MV_CACHE_DIR`.

The cache holds audio and each track's `.analysis.json`, `.show.json`, `.meta.json` and
`.context.json`, plus queue state, settings and review data. Treat saved shows, track edits
and settings as user data. Cache and downloaded models are gitignored.

After analysis or engine updates, queued tracks refresh as they become current or next.
Preparation reuses saved audio, so the original URL or imported file need not remain
available. Current engine arrangements are retained when the refreshed musical layout matches
and the show remains valid; other engine shows regenerate with their saved reroll seed.
AI-authored arrangements are retained when the audio identity still matches.

Workspace analysis reads `models/`, overridden by `MV_MODEL_DIR`. Desktop uses its bundled
model directory. The optional runtime models are:

- **Beat This!** for beats and downbeats, downloaded on demand with pinned digests.
- **Discogs-EffNet** for genre evidence, also downloaded with a pinned digest.
- **ADTOF** for kick/snare/hi-hat transcription, exported locally with
  [bench/export-adtof.py](bench/export-adtof.py).
- **HTDemucs + MDX23C DrumSep** separate the drums and then kick, snare, hi-hat and cymbal
  sources; ADTOF also transcribes the drum stem and each source. See
  [setup and model provenance](bench/lab/SEPARATION.md). Preparation can take minutes per song
  on CPU. Install the models before refreshing tracks; installing them later requires a fresh
  analysis of previously cached tracks.
- **Striker 1.0** (`striker.json`), LightningStrike's drum hit classifier trained by
  [bench/drumeval](bench/drumeval/README.md), picks the kick, snare and hi-hat hits from all of
  that evidence; without it, rule-based source recovery runs. See
  [evaluation and known limitations](bench/DRUM_RELIABILITY.md). Songs classified by another
  Striker model are re-analysed when next prepared; a model file that fails to load leaves them
  as they are.

Drum listening is available from the Judge panel. It plays the full song with optional kick
and snare clicks, loops a chosen passage, and keeps missed-hit and timing notes separately
from the show. Click empty space in either drum lane to mark a missed hit; save notes for
later comparison. Drafts remain in the browser if the page reloads.

Successful separation also keeps lossless source evidence and its transcriptions in
`cache/drum-evidence/` (up to 2 GiB, oldest entries evicted). Detector reanalysis can reuse
it when the audio, separator and ADTOF model match. Hardware-specific optimized CPU graphs
live in `cache/separator-graphs/`; these are derived files, not portable models. Per-track
`.preparation.json` records stage timings and the separator and Striker model versions.
See [performance measurements and M1 Pro profiling](bench/lab/SEPARATION-PERFORMANCE.md).

Analysis retains fallback paths when models are unavailable. Discogs-EffNet and ADTOF
weights carry CC BY-NC-SA terms and the MDX23C DrumSep weights are non-commercial too; preserve
their upstream licenses and export restrictions. Desktop builds bundle all of `models/`, so never
distribute a build that contains them.

The authoring API (`/api/author`) uses the Claude Agent SDK with local Claude authentication,
or DeepSeek through `DEEPSEEK_API_KEY` or a key saved in `settings.json`. The app no longer
opens it; shows it designed earlier keep playing.

## Hardware

DDP over UDP port 4048 is the default output; sACN is also available. The Bounce Lamp uses
its own one-pixel stream. Gamma is applied at the host's byte-encoding boundary, so receivers
must preserve those values without applying gamma again.

See [firmware/FIRMWARE.md](firmware/FIRMWARE.md) for boards, wiring, the standalone lighting
state machine, HTTP controls, calibration and flashing. The frame uses three SK6812 RGBWW
data lines; shows use RGB while standalone lighting can use the warm-white emitters.
