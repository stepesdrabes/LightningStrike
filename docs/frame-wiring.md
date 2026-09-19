# The Frame: 11.2 m of SK6812

673 addresses, three data lines, one Pico W, one salvaged 400 W PC supply.

**Built and running, 2026-09-08.** Everything electrical is done and has played real shows, laid
out on the floor at full size. What is left is the physical frame: profile, timber, hanging it, and
boxing the supply. The box is `supply-box.md`.

The patio is roofed, so rain never reaches the fixture. It is unheated and used mostly in warm
months, which leaves two things to respect: nothing under tension, and nothing sealed. A box that
cannot breathe in an unheated space collects the water it breathed in overnight.

---

## Measured, not estimated

On the real reel, 2026-09-07.

| | |
|---|---|
| Addresses | **300 per 5 m reel**, one IC per LED, 16.7 mm pitch |
| Byte order | **GRBW**, which is `SLOTS` in `fixture/rgbww.rs` |
| One 5 m reel at white 255, fed properly | **6.2 A** |
| One 5 m reel, every pixel black | **0.41 A** |
| **Whole frame at white 200**, the design point | **8.6 A / 104 W** |
| Whole frame at white 255 | 14.6 A / 176 W |
| Whole frame idle | 1.0 A |
| Strip loop resistance | **0.23 to 0.29 ohm/m** |
| Supply, unloaded | 12.20 V |
| Supply 5 V rail, at rest / under 12 V load | 5.03 / 5.13 V |

**White 200 is the design point**, being the top of what the room is actually used at. White 255 is
sized for anyway, because it is one tap away in the controller, but only to the standard of "the
far corners go slightly soft".

> **6.2 A is extrapolated, not read off the meter.** Fed from one end, a reel draws only 4.54 A at
> white 255, because its far end browns out and stops taking what it wants. The tell is the slope:
> each brightness step bought 5.78, 5.64 and 5.33 A per unit of light, then 2.69 for the last one.
> The first three are the strip; the fourth is the wiring giving up. Its far end sat at **8.64 V**.
>
> **A starved end on this strip goes cyan, not orange.** Red gives up first here, which is the
> opposite of the usual and of what most wiring advice says to expect.

### Measuring it again

`wash` at white 255 is the worst frame the firmware can make: `lin_rgbw` puts all four emitters at
full and `TRIM[3]` holds white to a quarter. A show cannot beat it, because `rgbww::unpack` puts
nothing at all on the white emitter.

```sh
curl -X POST http://room-frame/api/state -H 'content-type: application/json' \
  -d '{"power":"on","colour":"#ffffff","brightness":255,"effect":"wash"}'
```

Without a clamp meter, take the current in series at brightness **96, 128 and 180** - 9.1 %, 18.5 %
and 42.6 % of full. Nothing goes over 4.5 A. **Take the idle current out before scaling**, because
0.41 A of every reading is the ICs and does not answer to brightness:

```
I_full = I_idle + (I_measured - I_idle) x scale        scale = 10.95, 5.41, 2.35
```

Three answers that agree means the extrapolation holds; three that drift mean the strip is being
starved. Scaling the raw reading instead gives 10.3, 8.0 and 6.8 A off a perfectly healthy reel,
which reads as a starved one.

---

## The supply

400 W PC supply: **+12V1 17 A, +12V2 17 A, 360 W combined, +5V 20 A.** Nothing in it is stressed.

| Branch | From | Fuse | Feeds | Worst case |
|---|---|---|---|---|
| **A** | CPU 4-pin half 1: 2 yellow, 2 black | **10 A** | reel 1, both ends | 5.8 A |
| **B** | CPU 4-pin half 2: 2 yellow, 2 black | **10 A** | reel 2, both ends | 5.8 A |
| **C** | Molex: 1 yellow, 1 black | **5 A** | beam, `DI` end | 2.3 A |
| **5 V** | Molex red | 5 A | Pico VSYS, chip pin 14 | 0.25 A |

Two yellows per reel is 2.9 A a wire at the very worst. The reels land on the CPU rail and the beam
plus the electronics on the other, which is the rail split for free.

**PS_ON** is the green and one black from the 24-pin, cut close to the housing. The rest of the
24-pin, the second SATA and any other Molex are left intact: wires you are not using are already
insulated inside their own shells, which is tidier than a bundle of taped ends.

**Fuses go in a yellow or a red. Never in a black.**

**There is no ground bus at the supply.** Each branch takes its own ground pair straight out, since
they are already common inside the supply. The one common point is the ground bus **at the
fixture**, and the level shifter taps it there. Give the electronics their own return instead and
the Pico sits at supply ground while the strip sits half a volt above it, and that half volt comes
straight out of the logic margin.

The 5 V rail was checked because a 400 W unit with 20 A on 5 V is old enough to be group-regulated,
and VSYS is fed directly from it. It climbs 0.10 V under load and stays well inside the 5.5 V
ceiling, so no dummy load is needed.

---

## Cable

**At 12 V, cable is sized by volt drop, not by heat.** 2.5 mm2 carries 15 A without warming and
still loses 1.9 V over 8 m, which is 16 % of a supply that has no trim pot. The same cable on 230 V
loses the same 1.9 V and nobody notices.

`V = I x 0.035 x L / A`, with L the one-way metres and A the mm2. The 0.035 is copper's
0.0175 ohm mm2/m, doubled for the return.

Three thin trunks rather than one fat one: each branch keeps its own fuse at the supply and its own
rail, and every conductor fits a **WAGO 221-413**, which tops out at exactly 4 mm2.

The supply ended up in the patio beside the fixture rather than indoors, so the run is **1.5 m to
the frame and 3 m to the beam**, not the 8 to 10 m this was sized for. At that length 1.5 mm2 is
already enough and the 2.5 mm2 is spare.

| | at 200 | at 255 |
|---|---|---|
| Feed, 1.5 mm2 at 1.5 m, per reel branch | 0.13 V | 0.22 V |
| Feed, 1.5 mm2 at 3 m, beam | 0.10 V | 0.18 V |
| ~~Trunk, 2.5 mm2 at 8 m, per reel branch~~ | ~~0.40 V~~ | ~~0.69 V~~ |

For scale: 10.1 V looked clean on the bench and 8.64 V went cyan.

---

## The fixture

| Run | Line | Covers | Addresses |
|---|---|---|---|
| Reel 1 | **A**, GP2 | Frame N *(170)* + Frame E *(112)* | 282 |
| Reel 2 | **B**, GP3 | Frame W *(112)* + Frame S *(170)* | 282 |
| Beam | **C**, GP4 | the 1.82 m across the middle | 109 |

**Every `DI` end is at or within 1.5 m of NW.** Reel 1 leaves NW east along N, turns at NE, ends at
SE. Reel 2 leaves NW south along W, turns at SW, ends at SE. The beam leaves the middle of N and
ends at the middle of S.

`stripSpecs` in `packages/core/src/geometry.ts` walks the perimeter N, E, S, W as one loop, so its
two halves start at *opposite* corners. Laying B and the beam the other way brings every data line
to one place; `fixture/frame.rs` flips those two blocks to match. **Reversed in copper and not in
firmware, the room shows its own mirror image**, so the two facts move together.

**Each corner is cut and rejoined** with a short three-wire jumper carrying 12 V, GND and data.
Cut on a marked line between two LEDs, never across one. Every corner sits at its reel's
electrical midpoint, fed from both ends, so its jumper carries the least current on that reel.

The frame was built to the timber at just under 3 x 2 m, so a reel spends 282 of its 300
addresses and the rest is cut off. The 45 degree fold this was first drawn for needs no joint at
all and costs no length along the centreline, which is the better corner whenever the frame can
instead be built to the strip.

### Feeds

| Feed | Branch | Where |
|---|---|---|
| 1 | A | **NW**, reel 1 `DI` |
| 2 | A | **SE**, reel 1 `DO` |
| 3 | B | **NW**, reel 2 `DI` |
| 4 | B | **SE**, reel 2 `DO` |
| 5 | C | **N middle**, beam `DI` |

Both conductors at every point, 1.5 mm2, service loop at every joint. The two reds arriving at a
corner belong to different branches and **must not be joined**, or both 10 A fuses stop meaning
anything. The blacks are common and should be.

**What is built is one feed per run**, at each `DI` end, all three landing in the same corner. The
far end of a reel sits **above 10 V** at white 255 that way, clear of the 10.1 V that looked clean
on the bench, and the room reads right at every level a show uses. One feed per run is the answer,
not a compromise on the way to three.

It is worth knowing that this beats what the arithmetic here predicts. 5 m of strip at 0.29 ohm/m
carrying 6.2 A from one end would drop 3.3 V, which is what the 8.64 V above was. Either the strip
copper is better than that figure, which is easy if the ohm/m was read through un-nulled meter
leads, or the reel takes less than 6.2 A at 255. **Nothing hangs on which**, because a show never
gets near a white wash: `rgbww::unpack` puts nothing on the white emitter at all.

For reference, if a second feed is ever wanted: a reel fed at both ends sags **1.08 V at its
middle** at white 255, and 0.63 V at 200. A third at the corner fold takes that to 0.39 V.

### Data and capacitors

One twisted pair per line, **150 ohm** in series at the chip. 330 ohm was fine into 10 cm of jumper
but forms an RC with a real cable that eats an eighth of the shortest pulse in the protocol; 150
plus the chip's own 30 ohm output is close to the pair's impedance and kills the reflection
instead.

**One ground per pair, not one shared return for three data wires.** At 800 kHz the return current
wants the adjacent twisted conductor, and a shared wire does not give it one.

**1000 uF** across + and - at each strip's `DI` end, **stripe to ground**. At the supply it would
only parallel the PSU's own output caps; its job is to hold the local rail up against fast current
that the feed wire cannot deliver.

### The level shifter

One SN74HCT125N, three of its four channels.

| Pin | Goes to | | Pin | Goes to |
|---|---|---|---|---|
| **1** | GND *(enables A)* | | **8** | 150 ohm -> data C |
| **2** | Pico pin 4 = GP2 | | **9** | Pico pin 6 = GP4 |
| **3** | 150 ohm -> data A | | **10** | GND *(enables C)* |
| **4** | GND *(enables B)* | | **11** | nothing |
| **5** | Pico pin 5 = GP3 | | **12**, **13** | GND |
| **6** | 150 ohm -> data B | | **14** | +5 V |
| **7** | GND | | | |

**100 nF** across 14 and 7, as close to the chip as it sits. An enable pin left floating is a line
that measures perfectly and outputs nothing. **12 V on pin 14 kills the chip instantly.**

---

## Bring-up

The frame build is the default: `cargo run --release` from `firmware/node`, no `--features` flag.
`--features selftest` adds a ten second five-run colour pass at boot - **N red, E green, S blue,
W yellow, beam magenta** - which is the one look that shows a swapped pair. It is off by default
because `restore` exists so that a midnight power blip does not relight the room.

Each run also carries **five white dots, one LED in two, counted inward from each of its two
ends**. Every corner should show two of those marks mirroring each other across the fold, with
the two white LEDs meeting in the middle, and both beam ends should start on white:

```
Frame N                   NE fold                   Frame E
  ... n n n W n W n W n W n W | W e W e W e W e W e e e ...
```

A mark that runs off the corner, or a corner where the whites do not meet, is a run whose count
does not match the timber. The frame is built shorter than a full reel, so `LINE_*` and `RUNS` in
`fixture/frame.rs` and `counts` in `packages/core/src/geometry.ts` all have to agree with what the
marks show. No run is painted white, so the marks always read.

The Pico is fed from the supply's 5 V, so it only enters the bootloader if it is genuinely
unpowered when USB arrives: **USB out, supply off, hold BOOTSEL, plug USB in.**

Then, in the board panel:

| Region | Lights |
|---|---|
| **Frame S** | exactly the bottom run *(the left run plus a metre of the bottom means the flip is backwards)* |
| **Frame W** | exactly the left run |
| **Whole room** | all 673 |

Under a white wash, want **11.4 V** at the box, **11.2 V** at every injection point and **10.8 V**
at the middle of the longest gap between two feeds. On the stats line want `led` around 11500 us,
`fps` 60.0, and `torn` / `oob` / `bad` at zero. `led` near 26800 means the three lines are running
in sequence rather than together.

---

## What is left

- **Aluminium profile and opal cover, 12 m** in six 2 m sticks, butted with a 1 mm gap: aluminium
  moves about 2 mm over 2 m across a 40 degree swing. Profile first as a heatsink, strip clipped in
  mechanically rather than trusted to its adhesive, 20 mm left clear at each corner for the fold
  and its joint.
- **Timber.** N and S are whole 3 m beams; E and W are 2 m off the other two; the centre beam is
  the two 1 m offcuts spliced and plated on two faces, which is structurally uninteresting for
  something that only holds a light. Half-lap the corners so both undersides come out flush.
  Finish every face before assembly, end grain included.
- **Hanging it.** 21 kg of timber, 4 kg of profile, 2 kg of strip and wiring: **call it 30 kg over
  your head.** Four points into roof structure, not into cladding, each rated well past 30 kg on
  its own. This is the one part of the build where getting it wrong hurts a person.
- **The supply box**, which is its own procedure: `supply-box.md`. It carries the fusing, the
  unused-harness cleanup, the perfboard, the enclosure and the bring-up. **The shed move is
  cancelled** and with it the 2.5 mm2 trunks; the supply lives in the patio beside the fixture.
- **Nothing else.** One feed per run measures clean and the second feed is off the list.

---

## If something is wrong

| Symptom | Cause |
|---|---|
| One run dark, others fine | that branch's fuse, its data pair, or its enable pin |
| A run's far half goes **cyan** | starved. **Not** data. Add a feed |
| Colours right, wrong run lit | two data pairs swapped at the box |
| One line mirrored | `unpack_rev` and the copper disagree |
| Corner marks do not meet, or run past the fold | that run's count is wrong for the timber |
| Only the first LED of a run lights | data reached the strip but not past it |
| Nothing, and the strip looks fine | wrong end of the reel; move to `DI` |
| Random glitches | data pairs sharing a ground, or a breadboard that wants soldering |
| Supply will not start | PS_ON not shorted, or a short in 12 V |
| Supply shuts down on a white wash | both reel branches ended up on one 17 A rail |
| 5 V over 5.5 V | group-regulated with no load. Fit a 10 ohm 10 W |
| Fuse blows on one branch only | short in that run. Do not fit a bigger fuse |
| `led` ~26800 us | lines running in sequence, not together |
| Brightness uneven along one reel | that reel is missing a feed |
| Chip hot | 12 V reached pin 14. It is dead, fit another |

---

## Once it hangs

- Re-measure a **white wash** at the supply and check the fuses against it. Voltages change when
  wiring is dressed and cables are pulled straight.
- `TRIM[3]` in `firmware/node/src/fixture/rgbww.rs` is 64 of 256. **Raising it raises the peak
  current**, because the white emitter is a quarter of the budget above. Move it from what the room
  looks like, and re-measure if you do.
- Winter: switch off at the supply. `restore` means it comes back to what it was rather than
  lighting itself in March.
- The Bounce Lamp is a separate fixture on its own supply. Nothing here feeds it.
