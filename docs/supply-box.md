# The supply box

Taking a working floor build to something that hangs in the patio for a party on
**2026-09-19** and then lives there.

The electrical topology is settled and proven: CPU half 1 to reel 1, CPU half 2 to reel 2, one
Molex to the beam and the electronics, one feed per run at its `DI` end. **Nothing here changes
any of that.** What is missing is protection, packaging and mounting.

Read `frame-wiring.md` first. It has the load figures this is built on.

---

## What changed since `frame-wiring.md` was written

| Then | Now |
|---|---|
| Supply indoors, three 2.5 mm2 trunks over 8 to 10 m | Supply in the patio, **1.5 m** to the frame, **3 m** to the beam |
| A trunk drop of 0.69 V at white 255 | **0.22 V** on 1.5 mm2, so 1.5 mm2 is now enough and the 2.5 mm2 is spare |
| Level shifter grounds at the fixture | Grounds at the box, because 1.5 m of return is 0.14 V rather than half a volt |
| Feeds 1 to 5, both ends of each reel | **Three feeds, one per run**, at each `DI` end, measured clean |

The short run is the reason the last two are safe. At 6.2 A through 1.5 m of 1.5 mm2 the ground
offset between the perfboard and the strip is **0.14 V**, against an HCT input threshold of 2.0 V
and an output near 4.9 V. That leaves about 2.7 V of margin, which is why the data lines work
without a return of their own. **At the cancelled 8 m shed distance the same offset is 0.35 V and
climbing**, so if the supply ever moves, the return comes back with it.

---

## Load, and what each branch is fused for

Every 12 V figure is `frame-wiring.md`'s, scaled by address count.

| Branch | Rail | Feeds | Addr | idle | white 200 | white 255 | Fuse |
|---|---|---|---|---|---|---|---|
| **A** | CPU 8-pin, half 1 | reel 1 | 300 | 0.41 A | 3.6 A | **6.2 A** | **10 A** red |
| **B** | CPU 8-pin, half 2 | reel 2 | 300 | 0.41 A | 3.6 A | **6.2 A** | **10 A** red |
| **C** | Molex yellow | beam | 120 | 0.16 A | 1.4 A | **2.5 A** | **5 A** tan |
| **5 V** | Molex red | Pico, chip | - | 0.25 A | 0.25 A | 0.25 A | **3 A** violet |
| | | | **720** | **1.0 A** | **8.6 A** | **14.9 A** | |

**ATO blade fuses, not 5x20 glass.** Blade fuses are rated 32 V DC and their holders take 20 A;
the KLS5-708B family tops out at 10 A, which puts a 10 A branch fuse exactly at its ceiling.

A 10 A fuse on a 6.2 A branch never nuisance-blows and still clears a short: a dead short on this
supply is limited by its own OCP at 17 A a rail, which is 170 % of the fuse and clears in seconds,
and in practice the supply's OCP trips first. **A fuse smaller than 10 A is worse, not better**,
because an ATO fuse run above 80 % of its rating in a hot patio box does nuisance-blow.

**Four separate inline holders, not a bussed fuse block.** A bussed block joins the branch inputs,
which puts A, B and C on one rail. That is the failure in `frame-wiring.md`'s table: 14.9 A
against a 17 A rail is 88 % of OCP. Today A and B share the CPU rail at 12.4 A, 73 %, and the beam
plus the electronics sit on the other. Keep it that way.

---

## Parts

Already here, from the floor build:

- [ ] 400 W supply, working, with its IEC lead
- [ ] Pico W, SN74HCT125N, 3 x 150 ohm, 100 nF
- [ ] 1.5 mm2 silicone red and black, 0.5 mm2 for data
- [ ] 1000 uF capacitors, already at the strips
- [ ] 5 x WAGO 221-413

To buy:

- [ ] **4 x inline ATO blade fuse holder**, 16 AWG leads
- [ ] **Blade fuses**: 2 x 10 A red, 1 x 5 A tan, 1 x 3 A violet, **plus one spare of each**
- [ ] **IP65 ABS enclosure with a screw lid**, internal **200 x 150 x 75 mm** or larger.
      **Plastic, never metal**: the Pico W's antenna is inside it
- [ ] **Cable glands**: 1 x M20 for the supply bundle in, 3 x M16 for the branches out
- [ ] **Backplate**, 3 to 4 mm plywood or ABS, cut to sit inside the box
- [ ] **10 x WAGO 221-413** on top of the five you have
- [ ] **Adhesive-lined heatshrink**, 2 to 6 mm, enough for around 40 capped ends
- [ ] **SPST panel toggle** with a rubber boot, for PS_ON
- [ ] **Perfboard** 70 x 50 mm at 2.54 mm pitch, a **14-pin DIP socket**, 2 x 20-way female header
- [ ] **100 to 470 uF / 10 V** electrolytic for the perfboard's 5 V
- [ ] Zip ties, zip-tie bases, P-clips, labels
- [ ] **A spare SN74HCT125N.** It is the one part in the build that dies instantly and silently

Worth having: a **second Pico W, flashed and tested**, sitting in the night kit.

---

# Part 0: measure before you change anything

**On the floor build, exactly as it stands.** Everything after this is irreversible enough that a
baseline is worth twenty minutes.

## 1. Record the worst frame

```sh
curl -X POST http://room-frame/api/state -H 'content-type: application/json' \
  -d '{"power":"on","colour":"#ffffff","brightness":255,"effect":"wash"}'
```

Checked against the firmware as it stands: `lin_rgbw` returns all four emitters at 65535, `pack`
puts R, G and B at 255 with white held to 63 by `TRIM[3]`, `wash::render` is `out.fill(tint)`, and
there is no current limiting anywhere in `firmware/`. **No show can beat this frame.**

With it up, write down, for each of the three runs:

| Where | Reel 1 | Reel 2 | Beam |
|---|---|---|---|
| At the injection point, red to black | | | |
| At the far end of the run | | | |

These numbers are **a baseline to compare against, not a gate.** One feed per run already
measures above 10 V at the far end, clear of the 10.1 V that looked clean on the bench, and the
room reads right. Nothing below is waiting on them.

They are worth twenty minutes anyway, because **voltages change when wiring is dressed and cables
are pulled straight**. Part 6 takes the same reading with the frame hung, and a pair of numbers
that moved says which joint the dressing spoiled. One number on its own says nothing.

## 2. If you ever want to know whether a run is starved

Not now. But the test is cheap and needs no series break, so it is here for the day a run looks
soft at one end.

Take the far-end voltage **twice**, at brightness **255** and at **128**, and divide the two drops:

```sh
curl -X POST http://room-frame/api/state -H 'content-type: application/json' \
  -d '{"colour":"#ffffff","brightness":128,"effect":"wash"}'
```

Brightness 128 is 18.5 % of full light, so a reel taking full current draws
`0.41 + 0.185 x (6.2 - 0.41)` = **1.48 A** there against 6.2 A at 255.

| drop at 255 / drop at 128 | Means |
|---|---|
| **3.5 or more** | the reel takes full current and the strip copper is better than recorded |
| **2.5 or less** | the far half is browning out and only looks white |

A starved run is fixed with a second feed: 2 x 1.5 mm2 from the box to the `DO` end at SE, one
pair per reel. **The two reds must not be joined at SE**, or both 10 A fuses stop meaning
anything. The blacks are common and should be.

## 3. If you measure current instead

**Take the idle current out before scaling.** 0.41 A of every reading is the ICs and does not
answer to brightness, so scaling the raw number reports a healthy strip as a starved one. This is
corrected in `frame-wiring.md` too, where the mistake was:

```
I_full = I_idle + (I_measured - I_idle) x scale
```

Brightness 96, 128 and 180 read about 0.94, 1.48 and 2.88 A, all inside a meter's 10 A jack.
Corrected, all three land on 6.2 A. Raw, they give 10.3, 8.0 and 6.8 A: three drifting answers,
which the old procedure reads as a starved strip.

## 4. Note the supply, unloaded and loaded

| | Expect |
|---|---|
| 12 V at rest | 12.20 V |
| 5 V at rest / under 12 V load | 5.03 / 5.13 V |

Then **power off and unplug from the wall.** Everything below happens dead.

---

# Part 1: strip the supply

**The case stays shut.** The primary bulk capacitors sit near 320 V and hold it after unplugging,
and there is nothing inside worth that nine days before a party. Every wire that has to go can be
cut at its own connector housing instead.

## 5. Set aside what stays

| Keep | For |
|---|---|
| **CPU 8-pin**, both halves, all 4 yellow and 4 black | branches A and B |
| **One Molex**: 1 yellow, 1 red, 2 black | branch C and the 5 V |
| **24-pin**: green and one black | PS_ON |
| The IEC lead | mains |

Everything else goes: PCIe, every SATA, the other Molexes, the floppy tail, the rest of the
24-pin.

## 6. The one thing that turns a tidy job into a dead supply

**A thin wire is an input, not an output.** Among 18 AWG, a 22 or 24 AWG wire is a remote sense
line: the supply reads its own rail voltage back through it. A 400 W unit with 20 A on 5 V is old
enough to be group-regulated, which is exactly the design where 3.3 V is derived from the 5 V
winding, and a lost sense line lets 3.3 V climb until OVP shuts the whole supply down.

They are usually a thin **orange** or **brown** crimped into pin 13 alongside the thick orange,
sometimes a thin red or black in with their own colour.

**For every thin wire you find: splice it to a thick stub of its own rail and insulate the pair.**
Orange to orange, brown to orange, red to red, black to black. Then it still reads the rail and
everything else can be cut away.

If you would rather not have to spot them, **leave the whole 24-pin plug attached**, coiled and
tied, with green and black brought out of it. Bulkier, no risk at all, and it is what
`frame-wiring.md` originally called for.

## 7. Cut

Unplugged from the wall. The 5 V standby rail is live whenever mains is present, so this is not
optional.

**One wire at a time, capped before the next one is cut.** Two bare ends can never touch if only
one of them exists at a time.

1. Cut 25 to 30 mm from the housing.
2. Slide adhesive-lined heatshrink over the end and shrink it.
3. Next wire.

Stagger the lengths a little so the capped ends do not stack into one lump. Bundle what is left
against the supply's own case and tie it there.

## 8. PS_ON

Green and one black out of the 24-pin, **cut close to the housing** so nothing else in that plug
stays connected to them. They are joined today; they become the two tails of the toggle switch in
the box. Run them out with the rest of the bundle.

**Keep the Pico on the switched 5 V rail. Never on 5VSB.** Logic powered while the strips are not
pushes the data line's current through the first LED's input protection diode, and the first LED
of that run does not come back.

---

# Part 2: the perfboard

`frame-wiring.md` has the pinout. Four things it does not say, which start to matter once this is
soldered rather than pushed into a breadboard.

## 9. Socket the chip

**14-pin DIP socket, chip in the socket.** "12 V on pin 14 kills the chip instantly" is already in
your fault table, and a socket turns that from a soldering job at midnight into a ten-second swap.
Header the Pico for the same reason.

## 10. Layout

| Pin | Goes to | | Pin | Goes to |
|---|---|---|---|---|
| **1** | GND *(enables A)* | | **8** | 150 ohm -> data C |
| **2** | Pico pin 4 = GP2 | | **9** | Pico pin 6 = GP4 |
| **3** | 150 ohm -> data A | | **10** | GND *(enables C)* |
| **4** | GND *(enables B)* | | **11** | nothing |
| **5** | Pico pin 5 = GP3 | | **12**, **13** | GND |
| **6** | 150 ohm -> data B | | **14** | +5 V |
| **7** | GND | | | |

- **100 nF across 14 and 7**, legs as short as they go. An enable pin left floating is a line that
  measures perfectly and outputs nothing.
- **Each 150 ohm sits at the chip's own output pad.** It works against the cable together with the
  chip's 30 ohm output impedance, and moving it down the cable stops it doing that.
- **100 to 470 uF on the perfboard's 5 V.** The Pico W's radio takes current in bursts and half a
  metre of Molex wire has enough inductance to sag under them.
- **Pico VSYS is pin 39, not VBUS.** VSYS takes 1.8 to 5.5 V, and the on-board Schottky means USB
  and the supply can both be present without fighting.

## 11. Anchor everything that leaves the board

Zip-tie the three data wires and the 5 V pair to the backplate within 30 mm of the board. Nothing
that gets pulled should be able to pull on a solder joint.

## 12. Bench it before it goes in the box

5 V on the perfboard, USB out, meter on pin 14. **5 V, not 12 V.** Then the whole thing on the
floor build for one full show before it is screwed into anything.

---

# Part 3: the box

## 13. Fit the backplate

Cut plywood or ABS to sit on the box's internal bosses. **Everything mounts to the backplate.**
Never drill the back wall: that surface is what the seal depends on, and the box has external lugs
or a bracket for hanging it.

Top to bottom, so gravity and heat both work with you:

```
+--------------------------------------------------+
|  supply bundle in (M20 gland, at the top)         |
|                                                   |
|  [WAGO row: A yel  A blk  B yel  B blk  C  5V ]   |
|                                                   |
|  [ fuse A 10 ][ fuse B 10 ][ fuse C 5 ][ 5V 3 ]   |
|                                                   |
|  [ perfboard: Pico + SN74HCT125N ]                |
|                     Pico antenna end -> away      |
|                        from the steel anchor      |
|  A out    B out    C out       (M16 glands, down) |
+--------------------------------------------------+
        drain hole, 4 mm, at the lowest corner
```

## 14. Glands down, drain at the bottom

**Every gland points down.** A cable entering from below cannot run water into the box, and the
drip loop happens by itself.

**Drill a 4 mm hole at the lowest corner.** A sealed box in an unheated patio breathes: it warms
each day and cools each night, drawing damp air in through whatever gap it has, and the water
condenses inside and stays. On a roofed patio nothing sprays upward into a 4 mm hole, and the box
gets to dry out instead. The IP rating is worth less here than the box staying dry.

## 15. The Pico's antenna

The antenna is the exposed trace at the end away from USB. **Keep it 30 mm clear of the steel
anchor** and pointed out of the box rather than into the metal.

## 16. The switch

Toggle through the box wall with its boot, tails to green and black. It switches PS_ON, which
sinks a couple of milliamps, so any switch will do.

It kills the 12 V and the 5 V together while mains stays live at the supply, which is what you
want: the Pico goes dark at the same moment the strips do, and `restore` brings the frame back to
what it was holding.

**Mains stays switched at the socket.** No mains switch on this box.

---

# Part 4: wire the branches

Ground first, then +12 V, then data. Every time.

## 17. WAGOs and fuses

Twelve joints. **Fuses go in a yellow or a red. Never in a black.**

| # | 221-413 holds | |
|---|---|---|
| 1 | CPU half 1 yellow, CPU half 1 yellow, **fuse A in** | |
| 2 | **fuse A out**, feed A red | to reel 1 `DI` |
| 3 | CPU half 1 black, CPU half 1 black, feed A black | to reel 1 `DI` |
| 4 | CPU half 2 yellow, CPU half 2 yellow, **fuse B in** | |
| 5 | **fuse B out**, feed B red | to reel 2 `DI` |
| 6 | CPU half 2 black, CPU half 2 black, feed B black | to reel 2 `DI` |
| 7 | Molex yellow, **fuse C in** | |
| 8 | **fuse C out**, feed C red | to beam `DI` |
| 9 | Molex black, feed C black | to beam `DI` |
| 10 | Molex red, **fuse 5 V in** | |
| 11 | **fuse 5 V out**, perfboard +5 V | |
| 12 | Molex black, perfboard GND | |

Two yellows per reel is 3.1 A a wire at the very worst.

**There is still no ground bus.** Joints 3, 6, 9 and 12 are four separate returns, each going back
into the supply on its own copper. They are already common inside it, and joining them here only
invites the electronics' return to ride on the strip's.

## 18. Label every fuse

`A reel 1`, `B reel 2`, `C beam`, `5 V logic`, on the backplate beside each holder. At eleven at
night with the lid off and one run dark, this is the whole difference.

## 19. Bundle each branch with its own data line

Each M16 gland takes **one branch's red, black and data wire together**, run as one bundle the
whole way to the strip.

This is why the data lines work with no return of their own. At 800 kHz the return current wants
the nearest conductor, and a data wire running the whole way alongside its own branch's black has
one. Split them apart to tidy the run and you take that away.

**Add a fourth wire per bundle if you have twenty minutes.** 0.5 mm2 from the perfboard's ground
to where the power black lands at the strip. It is not really about noise: today, if a power black
ever comes loose at a strip end, the whole run's return current tries to go home down the data
line and takes the first LEDs with it. With a ground wire in the bundle, a lost black is a run
that goes dark and comes back.

## 20. Service loop at every joint

Both conductors, at every point, with slack. A cable pulled straight is a cable that pulls on
something.

---

# Part 5: hang it

## 21. The supply

Its own metal case, on the anchor, **earthed through its IEC lead. Do not defeat the earth.**

- **50 mm clear at the fan**, 100 mm clear behind the exhaust grille.
- **Fan not facing up.** Whatever falls in the patio falls into it.
- Off any surface that can pool, and out from under a roof drip line.
- At the design point it puts out 104 W and dissipates around 23 W, nothing for a 400 W unit. The
  fan may never spin up. That is fine.
- Fine mesh over the intake if wasps are a patio problem. At this load it costs no airflow.

## 22. Weight

The supply and the box together are about 2.5 kg on top of the 30 kg the frame already puts on
those four points. It changes nothing structurally, but hang them **on the anchor, not on the
frame**, so nothing electrical ever carries timber.

## 23. Mains

Fixed protected socket, the supply's own IEC lead, strain-relieved at the supply end with a P-clip
so the plug never takes the weight of the cable. Drip loop below the inlet. Do not coil the excess
tightly.

---

# Part 6: bring-up

## 24. Dead checks, lid off, nothing connected downstream

- [ ] Chip **pin 14 to pin 7 reads 5 V**, not 12 V
- [ ] All four fuses seated, correct values, labelled
- [ ] Every capped supply wire is capped
- [ ] Any thin sense wire is still spliced to its rail
- [ ] Nothing carries 12 V through the perfboard
- [ ] Every gland tight, drain hole open

## 25. Live, still nothing connected downstream

Mains on, PS_ON switch on. Black lead on a branch black:

| Red lead on | Expect |
|---|---|
| feed A red | 12.1 to 12.2 V |
| feed B red | 12.1 to 12.2 V |
| feed C red | 12.1 to 12.2 V |
| perfboard +5 V | 5.0 to 5.1 V |
| **chip pin 14** | **5 V** |

Anything wrong here costs nothing to fix. Past here it costs a chip or a strip.

## 26. Connect and light it

Off, then ground, then +12 V, then data, one run at a time. Then the board panel:

| Region | Lights |
|---|---|
| **Frame S** | exactly the bottom 3 m |
| **Frame W** | exactly the left 2 m |
| **Whole room** | all 720 |

`Frame S` showing the left 2 m plus 1 m of the bottom means the flip is backwards.

## 27. The acceptance measurement

`wash`, `#ffffff`, brightness **255**, against what Part 0 recorded:

| | Want |
|---|---|
| At the box | **11.4 V** |
| At every injection point | **11.2 V** |
| At the far end of each run | **within 0.2 V of Part 0** |
| `led` | around **12300 us** |
| `fps` | **60.0** |
| `torn` / `oob` / `bad` | **zero** |

`led` near 29000 us means the three lines are running in sequence rather than together.

**Voltages change when wiring is dressed and cables are pulled straight**, so this is the real
measurement and Part 0 was only the baseline.

## 28. Twenty minutes at white 200

Leave it up, then, by hand:

- Fuse holders: cool. A warm holder is a bad crimp, not a small fuse.
- Feed wires at the glands: cool.
- Supply case: warm is fine, hot is not.
- The strip: warm along its whole length, evenly. **A cool far half is a starved far half.**

Then run an actual show for a track or two and watch for a single glitched frame. Data problems
show as one run flickering, never as all three.

## 29. Write the numbers into `frame-wiring.md`

Measured, not estimated, is the whole point of that document.

---

# Part 7: the night kit

In a box, in the patio, on the 19th:

- [ ] Spare fuses: 10 A, 5 A, 3 A
- [ ] Spare SN74HCT125N
- [ ] Second Pico W, flashed and tested against the frame
- [ ] A known-good multimeter with fresh batteries
- [ ] The screwdriver that opens the box lid
- [ ] The fault table below, printed
- [ ] A step ladder that reaches the box

---

## If something is wrong

Everything in `frame-wiring.md`'s table still applies. These are the ones this build adds.

| Symptom | Cause |
|---|---|
| Supply will not start at all | the PS_ON switch, or green and black on the wrong two wires |
| Supply starts, then shuts down a moment later | a thin sense wire got cut. 3.3 V has run away into OVP |
| One branch dead, fuse intact | a WAGO that was never tugged |
| A fuse holder is warm | its crimp. Redo the joint, do not fit a bigger fuse |
| One run glitches, the others do not | that data wire left its own branch's bundle |
| First LED of a run dead, the rest fine | that run's black came loose while it was lit |
| Pico unreachable, lights fine | antenna against the steel anchor |
| Water inside the box | the drain hole is at the wrong corner, or a gland points up |
| Everything fine until a white wash | both reel branches ended up on one rail |

---

## Once it hangs

- **Winter: switch off at the socket, not just PS_ON.** `restore` means it comes back to what it
  was rather than lighting itself in March.
- The drain hole wants a look each spring.
- `TRIM[3]` is 64 of 256. Raising it raises the peak current, because the white emitter is a
  quarter of the budget above. Move it from what the room looks like, and **re-measure Part 0 if
  you do**.
- The Bounce Lamp is a separate fixture on its own supply. Nothing here feeds it.
