# CLAUDE.md

Development rules for LightningStrike. [README.md](README.md) covers setup and product use.

## Commands

Run from the repository root:

```sh
npm run dev                         # app, localhost:5180
npm test                            # Vitest
npm run check                       # TypeScript packages, web and controller
npm run build                       # production web build
npm run build -w @mv/desktop         # bundles server/runtime and builds desktop
```

Use Node 22+ with `ffmpeg`, `ffprobe` and `yt-dlp` on PATH. Desktop also needs the platform's
Rust/Tauri toolchain. Keep checks and relevant tests green; run the full check and test suite
before committing. Test behavior that can regress, not comment wording or trivial delegation.

## Architecture

- `core` has no external runtime dependencies: no Node, three.js or framework imports.
- `analysis`, `author-engine`, `preview3d` and `transport` depend on `core`.
- `author-ai` depends on `core`, `analysis` and `author-engine`; `apps/web` integrates them.
- `apps/desktop` runs the web server as a Node sidecar. `apps/controller` calls the firmware API.
- Keep the desktop Node version pinned in `apps/desktop/scripts/bundle-support.js`; the
  build machine's Node version must not silently change the shipped runtime.
- Respect package boundaries and declared dependencies. Workspace packages expose TypeScript
  source; no intermediate package build is needed.
- Product features belong in the app, not a new CLI. Build scripts and measurement harnesses
  are allowed; shipped code must never import `bench/`.

## Cleanup and comments

Default to no comment. Write one only for a non-obvious reason, invariant, unit/range,
compatibility constraint, hardware/model contract, or required license/tool directive.
Usually one or two lines are enough. Put long technical rationale in focused documentation.

When touching code, remove or shorten verbose comments. Delete narration, restatements,
historical fixes, benchmark stories and duplicated explanations. Keep each rationale in one
place. Do not move redundant prose into a new document merely to preserve it.

Executable prompt strings and embedded generated source are runtime inputs. Do not trim or
rewrite them as if they were ordinary comments, even when their contents look explanatory.
Preserve licenses and executable annotations such as compiler, linter and bundler directives.

For behavior-preserving cleanup:

- Preserve app behavior and rendered shows exactly, including numeric operation order,
  iteration order, seeded RNG consumption, timing, defaults and serialization.
- Preserve data schemas, cache keys and version constants. Do not invalidate caches,
  regenerate saved shows or change user settings as part of cleanup.
- Prove code is unused across routes, dynamic imports, workers, sandbox DSL exposure,
  benchmarks, build entrypoints and firmware feature targets before removing it.
- Preserve import side effects when removing types or narrowing exports. Delete unused code
  rather than hiding it with `void`, compiler suppression or a dummy reference.
- Choose verification appropriate to the risk; compare deterministic output when a refactor
  could affect a show. Do not broaden the task into a behavior change.

## Effects

One built-in effect per file under `packages/core/src/effects/`, exported as an `EffectDef`
and registered in `effects/index.ts`. Built-in and generated effects use the same
[gate](packages/core/src/effects/gate.ts):

- Deterministic: use `Rng` or `hash01`, never `Math.random`, `Date` or `performance`.
- No allocation in `render`; allocate in `create`.
- `reset()` restores the state of a fresh instance.
- Pixels stay bounded, finite and non-negative through the gate's section journey.

Use `SLOT` for palette colours, multiply speeds by `ctx.motion`, and derive musical time
constants from `ctx.f.beatPeriod`. Prefer existing DSL helpers over handwritten pixel loops.

Declare honest `taste` metadata. Section eligibility uses `sectionBase()`: drop/groove also
serve chorus/verse; list song-specific sections explicitly only for that distinct treatment.
`taste.activity` spends the per-cue motion budget. Drum-specific gestures declare `taste.kit`;
grid-locked strikes that read as the kit also gate on hit-envelope `Presence`.
Re-measure `taste.quiet` with `bench/quietprobe.ts` when changing effects in the quiet pool.

`f.spectrum` is high-rate spectral evidence; `f.bands` contains coarse per-beat envelopes.
Their scales differ. Use a `Follower` for spectral response; do not substitute either input
at the same gain. Preserve the distinction between local articulation and passage energy.

The `SLOT` ramp is not a hue wheel. `base..glow` changes saturation at near-constant light;
crossing toward `white` or `third` changes brightness. Prefer spatial colour variation;
keep fast temporal changes within `base..glow` and deliberate hue changes slow.

DSL exports are also vocabulary for generated effects, even without a built-in caller.
Update `renderDslReference()` in [catalog.ts](packages/author-ai/src/catalog.ts) when that
public vocabulary changes.

## Contracts and cache versions

`TrackAnalysis`, `TrackContext`, `Show` and `ShowFrame` in `packages/core/src/contracts/`
define package boundaries. Change contracts there and update every producer and consumer.
Cues use bars, never timestamps. Use [grid.ts](packages/core/src/grid.ts) for grid arithmetic
so analysis, composition and linting agree; do not duplicate its modulo logic.

For intentional semantic changes, bump `ANALYSIS_VERSION` when analysis shape or meaning
changes, `SHOW_VERSION` when composed output changes, and `CONTEXT_VERSION` when enrichment
needs invalidation. Pure cleanup must leave these versions unchanged.

Client mirrors in [types.ts](apps/web/src/lib/types.ts) deliberately avoid server-only
dependencies. Keep them synchronized instead of importing server code into the browser.

## Style and interface

- TypeScript strict mode, tabs, single quotes, semicolons, roughly 100 columns.
- No em-dashes in code, comments, documentation or commit messages.
- Effect imports group contracts, colour, DSL, then helpers.
- No `text-transform: uppercase`; write labels in the intended case.
- No left-edge colour bars. Use a dot, chip or background where a state needs an accent.
- No label or caption that merely repeats adjacent content.
- Keep chrome restrained: one accent for live states, monospace only for changing digits,
  and saturated colour reserved for the room.

## Commits

Commit only when asked. Use `type(scope): subject`, imperative, with a body only when the
reason needs explanation. Never add a co-author trailer.

Stage explicit paths, not `git add -A`. Never stage cache, downloaded models, measurement
corpora, generated renders or assembled desktop runtime artifacts.
