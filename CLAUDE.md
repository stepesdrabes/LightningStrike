# CLAUDE.md

House rules for this repo. `README.md` explains what LightningStrike is and why it is built this way;
this file is only the conventions.

## Commands

```sh
npm run dev      # the app on http://localhost:5180
npm test         # vitest over packages/*/src/**/*.test.ts and apps/*/src/**/*.test.ts
npm run check    # tsc --build across the packages, then svelte-check
npm run build    # production build of apps/web
```

The desktop build, from `apps/desktop`. `bundle` runs the web build itself, so it cannot ship
a stale server:

```sh
npm run bundle -w @mv/desktop   # build the server, fetch Node, assemble the runtime
npm run build -w @mv/desktop    # LightningStrike.app, or the Windows installers
```

Needs `ffmpeg`, `ffprobe` and `yt-dlp` on PATH, and Node 22+. Keep `check` and `test` green
before committing.

## Layering

```
apps/desktop  -> apps/web (as a running process, not an import)
apps/web      -> preview3d, transport, author-ai, author-engine, analysis, core
author-ai     -> author-engine, analysis, core
author-engine -> core
analysis      -> core
core          -> nothing
```

`core` imports nothing at all: no `node:`, no `three`, no framework. That is what lets the
same show run in a browser, in headless Node and eventually on a microcontroller. The
`package.json` files enforce the direction; do not route around them.

The app is the only way to use this. No CLIs, no `scripts/` for driving it: if something is
worth doing, it is worth a control in the interface.

`apps/desktop/scripts/bundle.js` is not an exception to that. It assembles a build and is never
run to use the product. Measurement harnesses are the other kind of exception: they answer a
question about the room, they never light one, and nothing shipped may import them.

## Comments

Let the code speak for itself. A comment earns its place by saying **why**, not what:

- keep the reason a value is what it is, a hardware or perceptual constraint, a trap that
  looks like a mistake until you know the reason, and units or ranges on interface fields;
- drop anything that restates the line below it, and do not narrate fixed bugs - keep only
  the invariant that stops the bug coming back;
- one rationale, one place. If the contract already explains it, the implementation does not
  repeat it.

No em-dashes anywhere: code, comments, docs or commit messages. Use a plain hyphen.

## Effects

One effect per file in `packages/core/src/effects/`, exported as an `EffectDef` and listed in
`effects/index.ts`. Every effect, built-in or generated for a track, must pass the same gate
in `effects/gate.ts`:

- **Deterministic.** No `Math.random`, `Date` or `performance`. Use `Rng` or `hash01`, so a
  seek reproduces the frame exactly.
- **No allocation in `render`.** Allocate in `create`.
- `reset()` restores a fresh instance.
- Bounded, finite, non-negative pixels across the gate's groove/build/void/drop journey.

Colour goes through `SLOT` so a show's palette reaches the effect without it knowing any
hues. Multiply speeds by `ctx.motion`; derive time constants from `ctx.f.beatPeriod`, never
from bpm. `taste` metadata is what the linter enforces restraint with, so fill it in honestly,
and keep `sections` to the ones the effect is actually for: it is a hard filter, and an effect
that claims every section will be picked for one it has no business in. Sections come in two
vocabularies - club (`drop`, `groove`) and song (`chorus`, `verse`) - and eligibility is
checked through `sectionBase()`, so a drop effect serves a chorus without listing it; list
`chorus` or `verse` explicitly only for an effect written for that reading and not the other.
Every effect rates `taste.activity`, how much of the room's light moves at frame scale (1
for a whole-room strike on every hit, 0 for a field), which the picker spends as a per-cue
budget so one layer hits and the rest move or hold; an effect without it counts as still.
An effect whose whole gesture answers one drum stream declares `taste.kit`, and the picker
keeps it out of passages where that stream is silent; a grid-locked pulse that reads as the
kit additionally gates its strikes on a `Presence` of the hit envelope, so a suspension rests
the room instead of being pounded through. A change to what the engine composes must bump
`SHOW_VERSION`, or every already-cached track keeps its old show and never hears the fix.

Two traps that have each cost a rewrite:

- **`f.spectrum` and `f.bands` are not interchangeable.** The spectrum is a 50 Hz measurement
  resampled per frame; the band envelopes are per-beat and cannot move inside a bar. They are
  also not the same scale - a band is normalised across the track and reaches 1.0 in any loud
  passage, the spectrum is a fixed window well under it, so swapping one for the other at the
  same gain changes how much room an effect fills. Read the spectrum through a `Follower` for
  anything that should answer the music; use the envelopes for how loud a passage is.
- **The `SLOT` ramp is not a hue wheel, and its three spans are not alike.** Measured over 24
  hues through the real ramp: `deep` to `base` is x12.5 in flux, a brightness step; `base` to
  `glow` is x1.03 flux and x0.86 peak channel, a SATURATION move at constant light; `glow` to
  `white` is x2.66. So a second colour means crossing past `white` toward `third`, and that
  crossing is a brightness event. Vary colour by POSITION freely; vary it over TIME only
  slowly, and only inside `base..glow`, which is the one span that costs no light - which also
  makes `glow -> base` on a hit the cheapest punch in the system.

Reach for the DSL before writing the loop by hand: `ringU`, `alphaFor`, `setPixel`,
`fillSolid`, `stampOnStrip`, `ringsFor`/`scatter`, `fadeToBlack`, `Follower`, `PulseEnv`,
`Presence`.
Anything added under `src/dsl/` also becomes vocabulary for Claude-generated effects, so
document it in `renderDslReference()` in `packages/author-ai/src/catalog.ts`.

## Contracts

`TrackAnalysis`, `Show` and `ShowFrame` in `packages/core/src/contracts/` are the seams
between the DSP, the model and the renderer. Change them there and update both sides.

Cues are addressed **by bar, never by time**. All grid arithmetic lives in
`packages/core/src/grid.ts` (`barTimeAt`, `onPhraseGrid`, `nearestPhraseBar`); the analyser
and the linter have to agree on it, so neither writes the modulo out by hand.

Bump `ANALYSIS_VERSION` when the analysis shape changes, or cached blobs go silently stale
rather than obviously broken.

## Interface

Three rules, in `apps/web`. They are absolutes rather than preferences, because each one is a
tell that an interface was assembled rather than designed:

- **No `text-transform: uppercase`.** Write a label in the case it should be read in.
- **No left-edge colour bars.** The `border-left: 3px solid <colour>` list row is out. A dot, a
  filled chip or a full background says the same thing without pretending to be structure.
- **No label that only rephrases the thing next to it.** A heading reading "room-node" does not
  need "A Pico W on the same network" underneath it, and a section whose contents announce
  themselves does not need a caption. Say the next thing or say nothing.

Beyond those: one accent, spent only on states that are genuinely live; monospace only where
digits change in place; and the room is the only saturated thing on screen, so chrome that
carries a hue is competing with the thing being judged.

## Style

- TypeScript, `strict`, tabs, single quotes, semicolons, around 100 columns.
- Packages are consumed as `.ts` source, so there is no build step between editing one and
  seeing it in the app.
- `noUnusedLocals` and `noUnusedParameters` are on: delete unused code rather than `void`-ing
  it to keep the compiler quiet.
- Effect imports group contracts -> color -> dsl -> helpers.
- Client-side mirrors of server types (`apps/web/src/lib/types.ts`) are duplicated on
  purpose, so the browser bundle never reaches into a server-only package. Keep them in sync
  by hand.

## Commits

Conventional Commits: `type(scope): subject`, imperative, body only when the reasoning is not
obvious from the subject. Never add a co-author trailer.

Only commit when asked. Stage explicit paths rather than `git add -A`: `apps/desktop` holds
around 270 MB of assembled runtime that is ignored today only because someone remembered to
ignore it, and `cache/` fills with whatever has been played.
