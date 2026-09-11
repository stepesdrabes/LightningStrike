# LightningStrike

Music-driven lighting for a room, with a 3D preview and matching output to real fixtures.
The room has a 720-pixel ceiling frame and a one-pixel Bounce Lamp. Local audio analysis
finds the musical grid; a deterministic engine composes the show. Optional AI authoring
can revise its pacing, palette and effects.

The preview and hardware use the same renderer and encoded pixels. Hardware output runs
in Node over DDP or sACN; the browser supplies the audio playback position.

## Use it

- Search YouTube Music, paste a supported URL, or paste a local audio path.
- Queue tracks, reorder them, or let radio keep the queue supplied.
- Watch the room preview, inspect the arrangement, and configure hardware in the app.
- Use Lounge for ambient lighting over music. When playback stops, the room fades into
  ambient scenes; stale browser sync also lets the hardware return to ambient.
- Revise a show with an AI author when you want a different interpretation. Engine shows
  work without an AI account.
- Share the queue's QR code so guests can add tracks from their phones and withdraw their
  own unplayed additions. Queue management, authoring and hardware controls stay with the host.

Space toggles playback; arrows seek, with Shift for larger jumps. Cmd/Ctrl-K opens search,
`[` and `]` toggle the side panels, and `L` toggles Lounge.

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
available. Engine shows regenerate; AI-authored arrangements are retained when the audio
identity still matches.

Workspace analysis reads `models/`, overridden by `MV_MODEL_DIR`. Desktop uses its bundled
model directory. The optional runtime models are:

- **Beat This!** for beats and downbeats, downloaded on demand with pinned digests.
- **Discogs-EffNet** for genre evidence, also downloaded with a pinned digest.
- **ADTOF** for kick/snare transcription, exported locally with
  [bench/export-adtof.py](bench/export-adtof.py).

Analysis retains fallback paths when models are unavailable. Discogs-EffNet and ADTOF
weights carry CC BY-NC-SA terms; preserve their upstream licenses and export restrictions.

Optional Claude authoring uses the Claude Agent SDK with local Claude authentication.
For DeepSeek, enter a key in the app; it is saved in the cache's `settings.json`.
`DEEPSEEK_API_KEY` takes precedence over the saved key.

## Hardware

DDP over UDP port 4048 is the default output; sACN is also available. The Bounce Lamp uses
its own one-pixel stream. Gamma is applied at the host's byte-encoding boundary, so receivers
must preserve those values without applying gamma again.

See [firmware/FIRMWARE.md](firmware/FIRMWARE.md) for boards, wiring, the standalone lighting
state machine, HTTP controls, calibration and flashing. The frame uses three SK6812 RGBWW
data lines; shows use RGB while standalone lighting can use the warm-white emitters.
