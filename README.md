# LightningStrike

A lighting show for a 5 x 4 m room, lit by a 3 x 2 m aluminium frame hanging at 2.4 m: four
runs forming a closed perimeter ring, plus a 2 m beam across the middle, every LED facing the
floor. 720 pixels at 60 LED/m. Beside it stands the Bounce Lamp, a one-pixel fixture that takes
the show's accent colour and pulses on the kit.

The same bytes drive a three.js preview of the room and the real strips over DDP, or over
sACN where the controller wants that instead.

## The idea

Claude has no ears. As of August 2026 there is no audio input modality, and feeding a
vision model a spectrogram does not rescue it: VLMs sit near chance on spectrogram tasks,
and at Opus 5's resolution cap a four-minute track is about 2.6 s per image patch column.
Audio models that *do* have ears score under 30% on structural segmentation with
timestamps, and collapse their answers to round numbers like "60s".

So the split is:

**DSP decides *when*. Claude decides *what* and *why*.**

Local analysis produces a bar-indexed table of the track: tempo grid, downbeat phase,
sections with energy ranks, per-bar band energies, onset lists, and a list of cue-worthy
moments. Claude only ever emits bar indices, and a linter rejects anything that is not in
the supplied grid. It cannot invent a timestamp because it is never asked for one.

What is left for the model is the part DSP cannot do: pacing, restraint, colour discipline,
interpretation, and knowing which single moment deserves the biggest move.

It is not working blind, either. It gets the audio file and a shell, so it can run ffprobe and
ffmpeg against it; and web search, so it looks the track up - artist, scene, published tempo
and key, lyrics, whether the act has a visual identity - and designs for what the song
actually is rather than for its genre. Tempo is the one thing research may override: if the
detected figure disagrees with a published one by a suspicious ratio, it can call `reanalyse`
and the whole grid is rebuilt around the corrected value.

The engine path is not working blind any more either. Ingest resolves what a rip actually is
from keyless free APIs - yt-dlp's own music metadata, song.link, Deezer (ISRC and published
tempo), iTunes and MusicBrainz genres, LRCLIB synced lyrics - and an 18 MB genre model then
listens to the middle of the track and outvotes the record shop where they disagree: The
Weeknd is filed under R&B while Blinding Lights is synthwave, and the room lights the record
that is playing. All of it lands in a cached `TrackContext`; every lookup is timeout-guarded
and optional, so an offline ingest degrades to exactly what it was before any of this existed.
A published tempo that re-hears the detected one at a clean ratio corrects the metrical level
automatically - the same correction the agent has always been allowed to make from research,
now made by the engine from the same kind of evidence.

## What gets ripped

Searching all of YouTube returns uploads; searching YouTube Music returns releases. For one
query the old path offered a lyric-video reupload, a mashup, a "slowed to perfection" edit and
a visualiser before it offered the record. That is not only ugly - a spoken intro, a crowd, or
a rate-shifted edit corrupts onset and tempo detection, so a noisy pick produces a wrong grid
before anything is lit.

So search goes through YouTube Music's own API, unauthenticated and with no key, filtered to
`MUSIC_VIDEO_TYPE_ATV` - the auto-generated "art track" that is the distributor's own master
under static cover art. Clean audio stops being a heuristic over titles and becomes a flag in
the response. Live cuts, karaoke and slowed edits still exist there, so they are pushed below
the plain recording unless the query asked for one.

Three things fall out of it for free. Artist, title and album arrive as separate fields, so
identity resolution starts from the catalogue rather than from parsing "CHRYSTAL - THE DAYS
(NOTION REMIX)" - `resolvedBy` reads `ytmeta` instead of `titleparse`. The artwork is the
square sleeve rather than a video still, which matters because yt-dlp's still is that sleeve
pillarboxed into 16:9 on a flat fill covering nearly half the frame, and that fill drags the
hue the chrome borrows. And every art track has a radio, which is what the queue tops itself
up from.

Nothing else is on the way in. Spotify cannot supply decodable audio by any route its terms
allow, and its developer policy separately forbids synchronising recordings with visual media,
which is a fair description of this program.

## The radio

A track's own radio on YouTube Music is 50 neighbours in one request. It takes after what
seeded it: seeded from an art track it returns art tracks, seeded from a music video it
returns music videos - so a seed that is not already a clean release is looked up by name
first, which is also how a track ripped before any of this existed gets a clean radio.

It is offered four ways: a dial in the queue header that keeps the set list from running out,
an action on any row, a strip under the queue, and the palette opened with nothing typed. The
automatic one appends a single track at a time and only when fewer than two unplayed rows are
left, so the machine prepares one download per track played rather than committing the next
hour. It is seeded from a blend of the last few tracks rather than from one, which is what
stops a night drifting into whatever the first song suggested, and it will not offer a song
the queue has already held - including under another remixer's billing, which is how the same
record otherwise comes back around twice.

The system prompt is written to Anthropic's Opus 5 guidance (no self-verification
instructions, no shouted emphasis, the hardest constraint restated last) and the craft in it
is attributed - Rosenberg on spending strong colour sparingly, Sinclair on putting the darkest
cue immediately before the brightest, Rutherford on which colours mechanically dominate which,
the Pixar colour-script idea, and Mickey Mousing as the name for the trap of illustrating
every lyric.

## Layout

Dependencies flow downward only. `core` imports nothing at all, which is what lets the same
show run in a browser, in headless Node, and eventually on an ESP32.

```
apps/desktop          Tauri shell, runs apps/web as a Node sidecar
apps/web              SvelteKit, one screen, plus the phone-sized guest page
packages/preview3d    three.js room view          -> core
packages/transport    DDP and sACN over UDP       -> core
packages/author-ai    Agent SDK, tools, backends  -> core, analysis, author-engine
packages/author-engine  deterministic show generation + the linter  -> core
packages/analysis     ffmpeg -> PCM -> SuperFlux -> beat grid -> bars -> sections  -> core
packages/core         contracts, geometry, colour, DSL, 91 effects, mixer, player, director
```

The layering is enforced by separate `package.json` files rather than by convention: `core`
physically cannot reach `node:dgram` or `three`.

## Three contracts

`TrackAnalysis` is what the DSP emits and Claude reads. One row per bar, energies
normalised across the whole track so relative judgement is trivial.

`Show` is what Claude emits. Cues are addressed **by bar, never by time**, and compose an
inline layer stack from the effect library plus any effect generated for that song.

`ShowFrame` is what an effect sees. Every field is exact arithmetic on the tempo grid or a
sample of the baked timeline, so there is no realtime DSP anywhere and no estimate to carry
a confidence.

## Two authors

The room is lit before anyone decides whether to spend a model on it. `author-engine` composes
a complete show from the analysis alone in about a millisecond: it covers every bar, keeps
each effect inside the taste metadata it declares, reserves the biggest look in the catalog
for the peak section and nowhere else, climbs the intensity through a build, cuts the light in
every void, and lints clean. It also knows what kind of night it is running: a genre profile
(fifteen families, distilled from how working designers actually light each of them) sets the
palette discipline - techno gets one hue and white, pop may pastel, metal runs hot - the
motion clock, how often the drum layer answers, and what marks a peak: a slam, a bloom, or a
swell. The flash is rationed by the same table: strobes and blackouts share a budget scaled by
genre and by how hard the track actually goes, so a techno night earns several phrase-locked
strobes, a pop song one or two chorus-tied, and a ballad none at all - and the linter enforces
the same allowance the planner spends. The allowance governs the effects themselves too: a
family that has earned no flashes does not get blinder slams or strobes as ordinary layers
by another door. The craft that survives every genre is structural now as well - the bar
before a drop dips instead of peaking, the first chorus holds its accent back so every return
adds something, a ballad's biggest arrival is a two-bar rise rather than a one-beat step, and
dim sections gain chroma rather than losing it, because a dim room drained of colour reads
grey, not hushed. It is deterministic - the seed is the analysis hash, so
the same track is the same show every time, and a different track is a different one. Reroll
steps that seed and composes again, which is how a favourite track stops being one picture
forever without giving up a bug that reproduces.

What it cannot do is know what the song is. So `author-ai` does not write a show; it revises
that one. Handing the agent a draft that already satisfies every structural rule spends it on
the part only it can do - what the track is, which moment deserves the biggest move, and the
two to five effects written for this song and no other - instead of on bookkeeping it is worse
at than a loop. If it fails, the engine's show is still there.

This is the one place the old iteration of this project was clearly right and worth copying:
compile the whole show ahead of time from a structural analysis, then execute it as timecode.
Its two acknowledged weaknesses are fixed here rather than carried over - the peak is reserved
before anything else is chosen rather than every drop being identical, and no two consecutive
cues may share a layer stack.

The agent can also see what it made. `preview_show` plays the show through the same mixer that
feeds the wire and reports what the room receives per cue: delivered brightness in bytes rather
than in the authoring domain, how many walls are lit, movement across a phrase against shimmer
at frame rate, which punctuation actually fires, and any bar that goes dark without a void or a
blackout asking it to. A show can lint clean and still hand back a black intro; the linter is a
static check and will never know.

Which model does this is a choice in the app. Claude is the default. DeepSeek V4 Flash publishes
an Anthropic-compatible endpoint, so a second backend is an environment for the same subprocess
rather than a second agent loop, and it costs roughly two orders of magnitude less per show.

## Effects

One effect per file in `packages/core/src/effects/`. Each declares taste metadata (energy
1-5, allowed sections, min/max bars, whether it is reserved for one moment per show, and how
hard it hits) so restraint is structural rather than something the author has to remember.
The last of those is spent as a budget per cue: one hit layer over a stable base, the rule
every console programmer works to, so a drop holds one whole-room striker and a moving look
rather than three layers all answering the same kick, and a verse holds none.

Some effects are a genre's signature - the techno shutter-cut, the drum & bass roller whose
pulses arrive front-centre exactly on the downbeat, the disco mirror ball, the blinder wall a
rock chorus earns - and the genre profile weights the picker toward them wherever they are
legal, without ever emptying a pool. Each show also plants one wildcard: a single look that
belongs to no section, midway through the longest steady passage, because the fiftieth listen
of a favourite track should still contain one thing it did not expect.

Claude writes two to five more per track, specific to that song. Each is admitted only after
passing the same gate the built-ins pass: finite, non-negative, bounded pixels across a
synthesised groove/build/void/drop journey; bitwise-identical output from two fresh
instances, which catches a smuggled `Math.random`; and `reset()` restoring a fresh state.

What an effect reads decides whether the room looks like it is listening. `f.spectrum` is a
real 50 Hz measurement resampled per frame; `f.bands` and `f.energy` are per-beat envelopes and
cannot move inside a bar however they are smoothed. Most of the catalog used to pass everything
through a beat latch to kill shimmer, which also threw away every stab, cymbal and word between
beats - and measured on a real track the shimmer turned out not to be there, while the latch's
own beat-rate stepping was. Level and articulation come off the spectrum through a `Follower`
now; the beat envelopes are left to say how loud a passage is, which is what they are good for.

The kit is read the same way. An effect whose whole gesture answers one drum - the kick tunnel,
the snare whip - declares which, and the picker keeps it out of any passage where that stream
is silent, because a kick effect over a sung verse is either a dead layer or a lie about the
arrangement. The grid-locked slammers keep their timing from the grid but take their permission
to strike from a `Presence` of the hit envelope, so when the producer pulls the kick out for
eight bars the room rests with it and comes back when it does. The same honesty governs
punctuation: a drop whose arrival bar carries no kick gets its slam demoted to a colour flood,
and the strobe keeps musical subdivisions but never exceeds 6 Hz - past that the flashes fuse
into a texture, measured in this room at 9.4 Hz on a 140 bpm track where the same gesture at
half the rate still reads as events, and heard again at 8 as "way too quick".

Colour is spent the same way. The palette slots are one ramp - deep, base, glow, white, third,
accent - and its three spans are not alike. Measured over 24 hues through the real ramp, deep to
base is x12.5 in flux, base to glow is x1.03, and glow to white is x2.66. So the bottom of the
ramp is a brightness step, reaching a second colour means crossing past white and paying for it,
and the one span in the middle is a saturation move that costs no light at all. Colour that
varies by POSITION in the room is free; colour that varies over TIME has to move slowly, or stay
inside base..glow, where a fast signal changes saturation rather than brightness.

The gate answers whether an effect is legal, which is not the same question as whether it looks
like anything, so an admitted effect is also measured: how much of the room it lights, how
concentrated that light is, whether its colour is one the palette can produce, and how far it
moves when the music drives it - asked twice, once over a drop and once over an intro with no
kit in it at all. The first track authored after that landed produced an effect that passed
every legality check while emitting nothing and ignoring the music; it took four revisions to
become something, and none of them would have happened against a tool that only said "passed".

Brevity is enforced rather than requested: the linter warns on a brief over ~150 words, on
long cue notes, and on a show with fewer than two effects of its own. The effort belongs in
the effects, not in prose about them.

## Models

Three ONNX graphs, none required: every consumer has a life without its model, so a machine
that cannot download still analyses.

- **Beat This!** (79 MB, MIT) finds the beats and downbeats.
- **discogs-effnet** (18 MB, CC BY-NC-SA) hears the genre from the middle of the track.
- **ADTOF** (2 MB, CC BY-NC-SA) transcribes kick and snare; hats stay on the DSP detector,
  which its published weak class is the reason for.

The first two are fetched once with pinned digests. ADTOF is not: its weights are
non-commercial, so it is exported locally by `bench/export-adtof.py` and simply absent on a
machine that never ran it.

Vocal stem separation was built, measured and removed. It cost about two minutes per track
and bought two subtle accent effects, a drum detector that heard marginally cleaner snares,
and boundary evidence the annotated corpora scored as worthless. The chorus and verse
detection that actually reads as intelligence comes from synced lyrics, which cost one free
HTTP call. If a stem is ever worth having again it wants to be a background upgrade after
the track is already playing, never a thing anyone waits behind.

## How the grid is found

Beat This finds the beats when its weights are present, which is the normal case; everything
below is what runs when they are not, and it still decides the metrical level either way.

Onset strength is SuperFlux: spectral flux on a log-frequency, log-magnitude spectrogram
where the frame being subtracted has first been passed through a maximum filter across
frequency, which is what stops a detuned supersaw reading as a continuous onset.

Tempo comes from a tempogram built two ways and multiplied. Autocorrelation asks "does this
curve repeat at this lag" and is strong at a tempo and every multiple of it; the Fourier
magnitude asks "is there energy at this rate" and is strong at a tempo and every divisor.
Their product keeps only what both agree on. A log-normal prior around 120 bpm and a test of
whether the resulting beats group into bars of three or four settle the metrical level, which
is the only part that is genuinely hard: on 245 annotated tracks from GTZAN and GiantSteps
this lands **75.9% exact and 91.8% up to a metrical factor**, which is where non-neural tempo
estimation sits. `tempo.confidence` reports the margin over the runner-up rather than a
goodness of fit, so a track whose octave was a coin toss says so, and `reanalyse` is there for
when Claude finds a published tempo that disagrees.

A constant grid is fitted rather than a beat sequence tracked, because programmed music has
no local wobble to follow and a constant grid keeps its phase across a quiet passage where a
tracker slips half a bar and slips back. Ellis' dynamic-programming tracker still runs, to
decide whether one period can describe the whole track at all; when it cannot, `constant` is
false and the bar table is the authority.

## How sections are found

Bar by bar, not frame by frame, and each bar keeps its own time axis: one row per beat across
thirty-two bands, so two bars match when they play the same pattern rather than merely
averaging to the same spectrum. That single choice is worth more than the algorithm on top of
it - published boundary accuracy rises by about a third for the same detector. The vector is
written with sixteen sub-frames per bar, but the rows underneath it are per beat, so in four-four
each group of four is a copy: it is beat resolution, not sixteenth.

Boundaries are then chosen by dynamic programming over the whole track at once, maximising
similarity inside each segment minus a cost for lengths that are not phrase multiples. The
cost is the point: hard-snapping to an eight-bar grid throws away nearly 40% of real
boundaries even in dance music, where a soft cost lets the evidence overrule the prior when
the music really does move at six bars.

A refinement pass then pulls each boundary onto the arrival next door when the evidence there
clearly beats it - the bar the sub slams, the kit returns, the bar before collapses. The DP
optimises cohesion, which is right everywhere except at a hard drop, where the drop bar and
the bar after it are nearly identical rows and the boundary slides one bar late - which is
exactly how the failures were reported from the room. A boundary placed on a measured arrival
is then pinned: the phrase snap may not drag it back onto a majority-fitted grid, because a
track that inserts an odd passage shifts its phrase phase mid-song and no single grid
describes it. For the same reason, phrases are counted from each section's own start -
punctuation, interior cue splits and `phraseStart` all walk the grid the audience is actually
counting on, which re-anchors at every drop.

A track that ends inside its loudest section still ends: the last kick leaves and the file
rings out, and the DP rarely pays for a boundary two bars from the finish. A trailing outro is
carved instead, the way the void is - walked back from the last bar while the kick is absent
and the level has clearly left the section's body - so the show winds down with the record
rather than holding the full drop stack through the decay.

Which sections repeat which is a transitive closure over segment similarity, so a third
chorus that only directly matches the second is still a chorus. Repeats of the same material
are labelled once, on pooled evidence: two passages of one group must not land on opposite
sides of the drop/groove decision, which is how a first drop used to come out `groove` while
its reprise came out `drop`.

Only then are they named, and the vocabulary is chosen per track first: club families read
drop/build/void, song families read verse/chorus - the same slots in the cue grammar,
different treatment, because a chorus is an anthem to bloom and a drop is an impact to slam,
and labelling a pop chorus `drop` is how it inherits a warehouse's strobe. Synced lyrics
sharpen the call where they exist: the chorus is the passage whose lines the track repeats,
so a loud verse carrying none of the hook is demoted and the section sitting squarely on the
repeated block is promoted. A loud passage is a drop when something set it up - a rise across
the boundary into it - and when the track has had two phrases to establish what it is dropping
from. `energyRank` is by mean rather than peak, so a long mid-energy verse containing one loud
bar cannot outrank a short chorus that is loud throughout.

## The app

One screen. The room is rendered full-window underneath everything and the chrome floats on
it, slightly transparent, so a lit room glows through the panels reporting on it. Behind that
sits the current cover, blurred past recognition - at that radius it carries no detail, only
the record's own colour, which is the one thing about a track the chrome can honestly borrow.
Everything else is greyscale, because the LEDs have to be the only saturated thing on screen.

- **Top bar** centres one field. Typing in it opens a command palette that lists the tracks
  already in the cache first, then searches YouTube Music. Opened empty it offers what the
  radio would play next. A pasted link collapses to a single row. Enter queues, Cmd-Enter
  plays now, Alt-Enter plays next.
- **Queue**, on the left, is the set list: drag to reorder, click to jump, live status while a
  track downloads and analyses, and a mark on the ones Claude has designed rather than the
  engine. Any row will start a radio off itself, and the dial in the header hands the whole
  queue to one.
- **Stage** is the 3D room, with view presets on one side and the lounge pill on the other, which
  names the look on the walls while the room is resting and lights when it actually has handed over
  rather than when the switch was thrown. The diffuser and bloom are fixed at the settings the room
  is meant to be judged at.
- **Player bar** is Spotify-shaped: art, title, prev/play/next, and a scrubber. The scrubber is
  the timeline: sections are drawn as coloured segments and what has not played yet is veiled
  rather than covered, so the arrangement stays readable ahead of the playhead. Hits are ticks
  on it. Hovering shows bar number and section.
- **Timeline drawer**, under the player, holds the raw LED bands - the exact bytes that go on
  the wire - and four lanes of sections, cues, drum density and punctuation.
- **Inspector** has three tabs: the show (Revise with Claude, Reroll, tempo, arrangement with
  the live cue highlighted under its section, palette, Claude's brief, the generated effects,
  linter notes), **design** (a live feed of what the agent is doing - every tool call, its
  arguments and its result, as it happens), and the raw log. It switches to design
  automatically while a show is being authored.
- **The board**, top right, is a live readout rather than a button: a dot and the frame rate
  the hardware itself reports. Opening it gives the address field, what the board says it is,
  how the stream is actually arriving, the frame rate, which wire it is addressed on, and the
  lead trim. See `docs/FIRMWARE.md`.

Space plays and pauses. Arrows seek 5 s, shift-arrows 30 s. Cmd-K opens the palette,
`[` and `]` collapse the two rails, `L` switches to lounge.

## The room when nothing is playing

A room that holds its last cue after the music stops is a room that has failed rather than one that
is resting, and an empty queue used to leave it dark altogether. So there is a second thing that can
light it, and one dissolve between the two.

Stop the music and the show is held still - the clock stops but `dt` keeps arriving, so without that
every phase accumulator carries on and the room lurches while its music sits still - and after two
and a half seconds, which is longer than any gap between two tracks, it dissolves over five into a
scene. Press play and the show is back in one and a half, because by then the music is already
sounding. **Lounge** is the same scenes over a track that is playing: they read the spectrum, they
change on section boundaries rather than on a timer, and a chorus blooms brighter than a verse
without ever reaching what a drop is allowed. The authored show is still there and switching back
costs a second and a half.

A scene is a bed and one texture, which is the shape of a quiet cue and for the same reason. Most of
them pair effects the catalog already had - the calm half of it has never had anything to ask for it
outside an intro - and five were written for this: a hearth, caustics off water and the single slow
ripple that crosses it, a dusk laid across the room rather than up it because every LED in this
fixture is at the same height, and lamps that wander the walls and settle.

Colour follows the record by default: its own palette, eased onto over fourteen seconds, held
through the gap to the next one so a room does not report a fetch by swinging colour and back. That
is the default rather than a fixed hue because the rest of this program exists to light the record
that is playing, and it costs nothing to prefer - a track with no show yet falls back to the cover's
hue, and one with neither falls back to the colour you picked. The other two are that picked hue,
and a drift slow enough that you only notice it having happened.

A hue picked on a wheel is in textbook degrees and the room runs on FastLED's ramp, so it goes
through `rampHueFor` before it can be a palette hue; a show's palette is already in ramp degrees and
must not. The slider's own track is drawn in the colours the strips will actually make rather than
in what CSS thinks a hue is.

Two things about the handover are not obvious. It needs a second mixer, because there is one buffer
per layer role and installing an effect zeroes it, so a show and a scene cannot share a stack. And
the two are mixed in light rather than in the authoring domain: that domain is gamma-encoded, so
halving both looks halfway across leaves a fifth of the light, and measured across a handover between
two looks that light different walls the room dropped to 60% of its own brightness in the middle of a
dissolve meant to be invisible.

It runs server-side too. The hardware follows a sync from the browser, and a sync that stops arriving
for three seconds is a tab that has closed - so the room rests then as well, rather than freezing on
whatever was on the walls when somebody shut the laptop.

Lounge is also where a track goes when the analyser loses it. Some grids defeat the DSP - a wrong
metrical level reads a pop song in 2/4 and every judgement downstream inherits the damage, thirty-five
cues over twenty-three sections changing looks every six seconds. The analysis carries its own trust
verdict, tripped by fragmentation rather than by confidence alone (one track sits at meter confidence
0.55 with clean structure while another at 0.88 is chopped to bits), and a track it does not trust runs
the lounge scenes instead of its authored show: the scenes follow the same spectrum and the same
boundaries without believing either very far. The queue row says so and offers to run the show anyway,
and that answer is remembered per track.

## The desktop app

`apps/desktop` is a Tauri shell around the same server. The backend stays Node, because the
analyser needs onnxruntime for Beat This, `child_process` for yt-dlp and ffmpeg, `dgram` for
DDP, and the Agent SDK spawns the `claude` CLI; so Rust owns the window and the server runs
beside it as a sidecar on a port chosen at launch.

```sh
cd apps/desktop
npm run bundle      # builds the server and assembles the runtime beside it
npm run build       # produces LightningStrike.app, or an .msi and a setup .exe on Windows
```

`ffmpeg`, `ffprobe` and `yt-dlp` are expected on PATH rather than bundled: a bundled yt-dlp
goes stale the next time YouTube changes, and the app names whatever is missing at startup.
macOS and Windows, and unsigned on both, so Gatekeeper will refuse it on any machine but the
one that built it and SmartScreen will want telling twice.

## The queue is server state

It lives in the Node process and is persisted to `cache/queue.json`, not in the browser. The
server owns `currentKey`; the browser watches it over SSE and plays what it is told. That is
what makes it possible for people in the room to add to the queue from their own phones later
without this deciding anything, and it means the hardware output re-points itself on a track
change with no browser involved. The dev server binds every interface for the same reason.

Preparing a track - download, analyse, compose - runs one job at a time, and only for the
current row and the one after it. The beat tracker is an ONNX graph that will take every core
it is offered, so two at once is slower than the same two in sequence and starves the render
loop besides.

That is also what the QR at the foot of the queue rail is for. Scanning it asks for a name
once, and a guest can then search, add, and take back something they added that has not
started playing. Everything else - skipping, reordering, clearing, the hardware, spending
credits on Claude - is loopback only, so being on the same WiFi is not the same as running
the night. Guests talk to a separate API that does not implement those verbs at all.

## Setup

Needs `ffmpeg`, `ffprobe` and `yt-dlp` on PATH, and Node 22+.

```sh
npm install
npm run dev            # http://localhost:5180
```

Authoring uses the Claude Agent SDK through your logged-in `claude` CLI. Note that since
2026-06-15, Agent SDK usage on a subscription plan draws from a separate monthly credit
pool.

To author with DeepSeek instead, paste a platform key into the field beside the button; it is
kept in `cache/settings.json`, which is gitignored, and the settings API is loopback-only like
everything else that spends money or drives hardware. `DEEPSEEK_API_KEY` in the environment
wins over the stored one.

## Commands

```sh
npm run dev            # the app
npm test               # 861 tests
npm run check          # tsc --build across all packages, then svelte-check
```

Everything else happens in the app: search for a track and the room lights. Artifacts land in
`cache/`: `<id>.<ext>` audio, `<id>.analysis.json`, `<id>.show.json`, `<id>.meta.json`, plus
`queue.json`. The cache is anchored to the workspace root rather than to cwd, so the dev
server and a production build share it. `MV_CACHE_DIR` overrides it.

The packages are consumed as TypeScript source rather than built to `dist/`, so there is no
build step between editing a package and seeing it in the app.

## Hardware

DDP over UDP on port 4048, which is what WLED listens on with no configuration. Two packets
per 720-LED frame at 94.9% wire efficiency, against five for sACN with universe maths on top.
The Bounce Lamp is a second device on its own stream, one pixel wide.

sACN is there as well, chosen in the board panel, because a controller that is not WLED
usually expects it. It costs what the arithmetic above says it costs, so DDP stays the
default rather than the only option.

Two things to get right:

- **PUSH only on a frame's last packet.** Set it on every packet and WLED renders three
  times per frame and tears.
- **The host owns gamma.** WLED's `arlsDisableGammaCorrection` defaults to true, so stock
  config already expects the source to have gamma-corrected. This does, once, at the
  byte-encode boundary, and both the preview and the wire get the same corrected bytes.

Hardware output runs server-side: the browser cannot open a UDP socket, and streaming 60
frames a second of pixels to the server would be pointless when the show is deterministic.
The server renders its own bit-identical copy from the same show and the same position; the
browser only reports where the audio actually is. The room keeps running if the tab closes.

WS2815 is 30 us per LED, so 720 pixels on one data line caps near 46 Hz. The board splits the
frame across two data lines instead - 300 pixels and 420, written together - which fits inside a
16.7 ms frame with room to spare. Passing several comma-separated hosts splits the fixture across
boards as well, for a room that outgrows one.

## Known gaps

- **The measurement harness is young.** `bench/` was rebuilt from nothing this pass: a corpus
  fetcher, a reanalyser that keeps ids, and probes for enrichment coverage, boundary
  arrivals, genre activations and the composed shows' scoreboard. What it did not have
  at first was annotated ground truth; it does now - 150 Harmonix and 120 Raveform
  tracks under `bench/corpus/`, scored by `bench/structscore.ts` - and the boundary tuning
  that ships is the variant that won on both corpora, not the one that argued best.
- **`taste.quiet` has a producer again** (`bench/quietprobe.ts`), and the stored numbers
  are current: measured post-revert over the full 35-track cache. The picker also now spends
  them as a rank within the eligible pool rather than as positions on an absolute scale, so
  the ordering is all that has to survive the next time the quiet pool or the house floor
  changes - magnitudes drifting stale no longer decides picks on their own. Nothing asserts
  the numbers; re-run the probe after touching any effect in the quiet pool.
- **Genre labelling is only as good as its two voters.** The metadata chain answers with the
  artist's genre and the audio model with the record's; where both are wrong the show still
  gets the default profile. The families themselves are a lighting vocabulary, so a wrong
  family is a wrong accent, not a broken show.
