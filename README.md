# LightningStrike

Music-driven lighting for a room, with a 3D preview and matching output to real fixtures.
The room has a 671-pixel ceiling frame and a one-pixel Bounce Lamp. Local audio analysis
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
- Click the LightningStrike mark (⌘,) for Settings: the analysis model and where it runs, the
  browser whose YouTube sign-in downloads use, radio and rest, the library and model folders,
  and the versions of the tools the app relies on.
- Watch Striker 2.0 at the top of the right rail. While a song plays, the view replays what the
  network heard and answered for it, locked to the music; while one prepares, each 90-second
  chunk's input goes in, the stages light in the order data passes them, each for its share of
  the arithmetic, and the outputs come back. The stages are read from the installed graph.

If YouTube refuses downloads on your network (some addresses get every signed-out request
refused while a signed-in browser still plays), choose that browser under Settings, YouTube.
Downloads then carry its YouTube cookies, read fresh each time by yt-dlp; no other site sees
them. macOS asks once for access to the browser's cookie key.

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
ARM64 application; Striker 2.0 runs locally, on the GPU through Core ML once it passes its check
there, else on the CPU, without Python or an NVIDIA GPU. Copy its model into `models/` first: the
build refuses to bundle without it.

## How it works

Ingest downloads or copies audio, decodes it with ffmpeg, and produces a `TrackAnalysis`:
beats, bars, sections, spectral features and musical events. Striker 2.0 hears the beats and
drums; metadata, lyrics and a genre model refine the result. The engine turns that analysis
into a bar-addressed `Show`; the linter checks the show before playback. AI authors use the
same contracts and effect gate.

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
| `packages/analysis` | Audio ingest, Striker 2.0, DSP and enrichment |
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
and settings as user data. Cache and downloaded models are gitignored. Each song prepared by
Striker 2.0 also keeps a `.hearing.bin` (1 to 3 MB, gzipped) for the model view: its input
features, its output heads and the real activations of its kept neurons, in bytes. Nothing
composes a show from it.

After analysis or engine updates, queued tracks refresh as they become current or next.
Preparation reuses saved audio, so the original URL or imported file need not remain
available. Current engine arrangements are retained when the refreshed musical layout matches
and the show remains valid; other engine shows regenerate with their saved reroll seed.
AI-authored arrangements are retained when the audio identity still matches.

Workspace analysis reads `models/`, overridden by `MV_MODEL_DIR`. Desktop uses its bundled
model directory. The models are:

- **Striker 2.0** (`striker2.json` beside its graph, `striker2.onnx`), one network that hears
  drum hits with levels, beats, downbeats, bass note onsets and stem activity at 100 fps.
  Preparation runs it in one stage on the 44.1 kHz decode; its beats go through a DBN to the
  grid, and its kick, snare and hat (with cymbals) are the hits the lights follow. The manifest
  records the graph's SHA-256 and the bass filter's taps, and the graph is checked against them
  before a song is prepared. It is copied in by hand: never committed, never downloaded.
- **Striker 2.0 Small** (`striker2-small.json` and `striker2-small.onnx`), a smaller export of
  the same network for slower machines, chosen in the library dialog. Until its files are in
  `models/` the dialog shows it as not installed and cannot choose it.
- **Discogs-EffNet** for genre evidence, downloaded on demand with a pinned digest.

Without a usable Striker 2.0 nothing is prepared: a missing file, a failed check or a failed run
stops the preparation with its reason, on the queue row and in `.preparation.json`, and never
falls back to another analyser. Songs keep the analyses they have meanwhile. An analysis
records the model's manifest name as `striker`; songs another model made, or made before a
model change, are re-analysed when next prepared. `.preparation.json` records stage timings and
the model's name, provider and warnings, or the error.

Where Striker 2.0 runs is the dialog's other Analysis setting (`analysisProvider`): Auto tries
the graphics card first (Core ML on Apple silicon, DirectML on Windows, CUDA on Linux), CPU is
the processor alone. Only a static graph goes to a graphics provider. Before a provider is used on
a machine it runs the manifest's golden chunks and must match PyTorch: every output within 1e-3,
every decoded event the same, within one frame and 0.01 in level. Otherwise the next one is tried,
ending with the CPU, which is checked too and runs whatever its verdict. Verdicts are kept per
graph, runtime, provider, threads and machine in `cache/striker2-providers.json`, so a pass is
checked once; a provider that fails on a song is marked failed and the song runs again on the CPU.
One session serves a whole preparation run (the ingest worker stays between songs) and closes
after 90 idle seconds. Changing the provider leaves analyses current.

Drum listening is available from the Judge panel. It plays the full song with optional kick
and snare clicks, loops a chosen passage, and keeps missed-hit and timing notes separately
from the show. Click empty space in either drum lane to mark a missed hit; save notes for
later comparison. Drafts remain in the browser if the page reloads.

Discogs-EffNet weights carry CC BY-NC-SA terms; preserve their upstream license. Striker 2.0's
weights, Small's included, are for personal use only, because its training data and teacher are
non-commercial ([models/striker2.NOTICE](models/striker2.NOTICE)). Desktop builds bundle them,
so never distribute a build that contains them.

The authoring API (`/api/author`) uses the Claude Agent SDK with local Claude authentication,
or DeepSeek through `DEEPSEEK_API_KEY` or a key saved in `settings.json`. The app no longer
opens it; shows it designed earlier keep playing.

## Hardware

DDP over UDP port 4048 is the default output; sACN is also available. The Bounce Lamp uses
its own one-pixel stream. Gamma is applied at the host's byte-encoding boundary, so receivers
must preserve those values without applying gamma again. Frames to a board that says it can
take them go out packed, losslessly, so The Frame arrives in one datagram instead of two.

See [firmware/FIRMWARE.md](firmware/FIRMWARE.md) for boards, wiring, the standalone lighting
state machine, HTTP controls, calibration and flashing. The frame uses three SK6812 RGBWW
data lines; shows use RGB while standalone lighting can use the warm-white emitters.
