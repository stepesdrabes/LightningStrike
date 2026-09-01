# The Frame: 12 m of SK6812, outdoors

720 addresses, three data lines, one Pico. Supply indoors, everything else in a sealed box at the
fixture.

The patio is roofed, so this is an outdoor build without the rain problem. What still matters is
condensation and thermal cycling; see **Weather**.

---

## Where things live

```
  BUILDING (dry)                    10 m                 PATIO
  ┌──────────────────┐                                   ┌──────────────┐
  │ wall switch      │                                   │ S-BOX 406    │
  │ LRS-350-12  ●────┼══ 6 mm2 red ═════════════════════▶│ 4 fuses      │
  │             ●────┼══ 6 mm2 black ═══════════════════▶│ WAGO bus     │
  └──────────────────┘                                   │ buck 12→5 V  │
                                                         │ Pico W       │
                                                         │ SN74HCT125N  │
                                                         └──┬────┬────┬─┘
                                                            │    │    │
                                                        line A   B    C
                                                        + 8 power feeds
```

**Why not the whole lot indoors.** Data at 800 kHz does not survive 10 m of cable reliably, and
12 V at 16.5 A over 10 m of anything you can bend is a lost volt or more. Putting the brains at the
fixture makes every data run under 4 m and every high-current run under 4 m. Only the trunk is
long, and a trunk is the one thing that copes with length.

**Why not the supply out there too.** Then you are running mains outdoors, which is a different
job with different rules. One 12 V trunk keeps 230 V inside the building.

---

## Numbers this is built on

| | |
|---|---|
| 720 addresses, all four emitters | **16.5 A / 200 W** |
| One 5 m reel at full white | 6.9 A |
| Beam, 120 addresses | 2.8 A |
| Every pixel black | **1.5 A** *(the 12 V droppers never stop)* |
| Trunk drop, 6 mm2 at full white | 0.95 V |
| Board time per frame, three lines | 12.3 ms of 16.7 |

A real show never reaches 16.5 A. The mixer holds a floor and compresses its own highlights. Size
for it anyway, because a pale frame left running is exactly what a light on a switch does.

---

## Weather

The patio is **roofed and rain never reaches the fixture**, which settles most of this. What is
left is humidity and thermal cycling, not water.

### IP30 is fine here

Bare-board strip under a roof is survivable and is what `hardware.html` specifies. The aluminium
profile with an opal cover is enough. It is not waterproof and does not need to be.

**Seal the top edge of the profile and leave the low end open.** Anything that does condense has to
be able to leave.

### Condensation is the one that is left

A roof stops rain, not damp air. The box outdoors still breathes with every day/night cycle.

- Mount the S-BOX with **all glands pointing down**
- Drill **one 3 mm weep hole** at the lowest corner
- **Desiccant sachet** inside, changed each spring

### Cold is fine, cycling is not

LEDs run *better* cold. What fails is adhesive and solder joints under repeated expansion.

- **Clip the strip mechanically.** Do not trust the 3M backing over a winter
- **Flexible silicone wire everywhere**, which is what you already have
- Leave a service loop at every solder joint so nothing is under tension

### The frame

**5 x 5 cm hardwood** from a painting stretcher, which is better than the 12 mm plywood ribs
`hardware.html` specifies. That section will not sag over 3 m and will not twist, and the profile
screws straight to it with no ribs to cut.

Finish all faces before assembly anyway. Hardwood outdoors under a roof still moves with humidity,
and an unfinished end grain wicks.

> The geometry in `packages/core/src/geometry.ts` is **3 x 2 m**. If you build to a different size,
> `DEFAULT_ROOM` changes and so does the pixel count.

## Shopping list

### You already own

- [x] SK6812 RGBWW, 15 m *(12 m used, 3 m spare)*
- [x] Raspberry Pi Pico W
- [x] SN74HCT125N x3
- [x] WAGO 221-413 x5
- [x] Fuse holder KLS5-708B x4
- [x] Blade fuses, 5 A and 10 A
- [x] SiF 1.5 mm2 red and black, 10 m each
- [x] SiF 0.5 mm2
- [x] 100 nF x6, 330 ohm, 1000 uF 25 V
- [x] S-BOX 406, IP65, 10 glands
- [x] Multimeter

### Still to buy

| Item | Why | Rough |
|---|---|---|
| **Mean Well LRS-350-12** | 29 A. The LRS-200 sits at 97 % of rating | 1000 Kc |
| **6 mm2 cable, 12 m red + 12 m black** | the trunk. 4 mm2 loses 1.4 V | 1200 Kc |
| **12 V → 5 V buck module** | the LRS has no 5 V rail. ~150 mA needed | 80 Kc |
| **Schottky or any 1N400x diode** | 5 V into Pico VSYS | 5 Kc |
| **1000 uF 25 V x3** | one per data line input | 30 Kc |
| **330 ohm x3** | one per data line | 10 Kc |
| **SiF 1.5 mm2, +25 m each colour** | 8 injection points around a 3 x 2 m frame | 800 Kc |
| **WAGO 221-415 (5-port) x6** | the ground bus has 10 conductors on it | 200 Kc |
| **Perfboard + pin headers** | a breadboard will not survive a winter | 100 Kc |
| **CAT5e, 15 m** | one twisted pair per data line | 150 Kc |
| **Aluminium profile + opal cover, 6 x 2 m** | heatsink first, diffuser second | 1320 Kc |
| **Mains cable, switch, IP box for the PSU** | indoor end | 500 Kc |
| Desiccant sachets, silicone sealant, heatshrink, clips, cable ties | | 400 Kc |

Frame timber is already owned: 5 x 5 cm hardwood.

---

## Three rules

1. **Fuse every run, at the fixture end.** One big fuse at the supply protects nothing: a short in
   one strip run would take 20 A through strip copper without ever blowing it.
2. **Ground first, then +12 V, then data.** Every time.
3. **Kill the mains at the wall before touching anything.** The trunk stays live otherwise.

---

# Part 1: the supply, indoors

### 1. Mount the LRS-350-12 in a closed box

It is open-frame. Live 230 V terminals are exposed. It needs an enclosure with the mains side
behind a cover.

### 2. Wire the mains

`L`, `N`, `PE` to the marked terminals. **PE is not optional.** Fit the wall switch on the live
feed, so one switch kills the whole fixture, which is the point.

### 3. Trim the output before anything is connected

Power on with no load. The trim pot is on the terminal end.

**Set it to 12.6 V.** That covers the 0.95 V the trunk loses at full white. At idle the fixture
sees about 12.5 V, which is under the strip's 13 V ceiling.

### 4. Power off. Verify with the meter, then wire the trunk

| Trunk conductor | To |
|---|---|
| **6 mm2 red** | `+V` |
| **6 mm2 black** | `-V` |

Run it to the patio. Leave both ends unconnected out there for now.

---

# Part 2: the box at the fixture

Everything below happens with the mains off.

### 5. Lay out the S-BOX

Glands **down**. Weep hole in the lowest corner. Rough placement:

```
   trunk in ─┬─ WAGO +12 bus ─── 4 fuses ─── 4 branch WAGOs ── out
             │
             └─ WAGO GND bus ──────────────────────────────── out
                    │
                    ├── buck 12→5 V ── Pico ── SN74HCT125N ── 3 data out
```

### 6. The +12 V bus and the fuses

| WAGO | Contents |
|---|---|
| **P** | trunk red · fuse 1 in · fuse 2 in · fuse 3 in · fuse 4 in |
| **F1** | fuse 1 out · reel 1 feeds *(3 wires)* |
| **F2** | fuse 2 out · reel 2 feeds *(3 wires)* |
| **F3** | fuse 3 out · beam feeds *(2 wires)* |

| Fuse | Protects | Rating |
|---|---|---|
| 1 | Reel 1, N + E, 6.9 A | **10 A** |
| 2 | Reel 2, S + W, 6.9 A | **10 A** |
| 3 | Beam, 2.8 A | **5 A** |
| 4 | spare | |

**P** and **F1**/**F2** need 5-port WAGOs.

### 7. The ground bus

Ten conductors share it: trunk black, six reel returns, two beam returns, and the electronics.
Chain two or three 5-port WAGOs rather than forcing it into one.

Keep the electronics ground on **its own** WAGO, fed from the bus by a single wire. Strip current
must never flow through the Pico's ground.

### 8. Measure before anything else goes in

Fuses fitted, nothing else connected. Mains on.

| Probe | Should read |
|---|---|
| **F1** to ground bus | **~12.6 V** |
| **F2** to ground bus | ~12.6 V |
| **F3** to ground bus | ~12.6 V |

Mains off.

### 9. The buck and the Pico

| From | To |
|---|---|
| **F4** or the +12 bus | buck **IN+** |
| ground bus | buck **IN-** |

Power on, **set the buck to 5.0 V before connecting anything to it.** Power off.

| From | To |
|---|---|
| buck **OUT+** | → diode, band toward the Pico → Pico **pin 39** *(VSYS)* |
| buck **OUT-** | electronics ground |
| buck **OUT+** | chip **pin 14** |
| electronics ground | chip **pin 7** |

The diode is what stops a laptop on USB back-feeding your 5 V rail when the mains is off.

### 10. The chip, three channels

| Channel | Enable → GND | Input | Output |
|---|---|---|---|
| A | pin **1** | pin **2** ← Pico **pin 4** *(GP2)* | pin **3** → 330 ohm |
| B | pin **4** | pin **5** ← Pico **pin 5** *(GP3)* | pin **6** → 330 ohm |
| C | pin **10** | pin **9** ← Pico **pin 6** *(GP4)* | pin **8** → 330 ohm |

Unused: pins **12, 13** → ground. **100 nF** between pin 14 and pin 7.

Pico **pin 3** *(GND)* → electronics ground.

### 11. Solder it to perfboard

A breadboard will not survive a winter. Contacts corrode, springs relax, and it fails as
intermittent glitches that look like WiFi.

---

# Part 3: the fixture

### 12. Mount the profile, then the strip

Profile first, as a heatsink. 13 to 18 W per metre with nowhere to go is what kills strip.

Strip clipped mechanically, **not** on adhesive alone. Cover on, top edge sealed, **low end left
open to drain**.

### 13. Cut and lay the reels

| Reel | Covers | Addresses | Data line |
|---|---|---|---|
| 1 | Frame N *(3 m)* + Frame E *(2 m)* | 300 | **A** |
| 2 | Frame S *(3 m)* + Frame W *(2 m)* | 300 | **B** |
| 3 | Beam *(2 m)* | 120 | **C** |

Cut only on the marked lines, every 16.7 mm. Reels 1 and 2 are uncut 5 m runs that turn a corner.

Pixel order is the wiring order: A starts at the **NW** corner and ends at **SE**. B starts at
**SE** and ends at **NW**. C runs along the beam.

### 14. Eight injection points

A 5 m reel at 6.9 A cannot be fed from one end. One edge takes about 4 A before its own copper
starves it.

| Feed | Where | From |
|---|---|---|
| 1 | reel 1 start, NW | F1 |
| 2 | reel 1 middle, **NE corner** | F1 |
| 3 | reel 1 end, SE | F1 |
| 4 | reel 2 start, SE | F2 |
| 5 | reel 2 middle, **SW corner** | F2 |
| 6 | reel 2 end, NW | F2 |
| 7 | beam, one end | F3 |
| 8 | beam, other end | F3 |

**The middle feeds are the ones people skip and regret.** Both ends alone still sags in the centre
at this current.

Solder the branches to the strip pads, both `+` and `-` at every point. 1.5 mm2 throughout.

### 15. Data, one twisted pair each

| Line | Pair carries | To |
|---|---|---|
| A | 330 ohm output + **its own ground** | reel 1 `DI` at NW |
| B | 330 ohm output + **its own ground** | reel 2 `DI` at SE |
| C | 330 ohm output + **its own ground** | beam `DI` |

**One ground per pair, not one shared return.** Three data wires sharing a ground is the classic
intermittent-glitch build.

Watch the arrows. Connect at the **tail**, the `DI` end.

### 16. One capacitor per line

**1000 uF**, across `+` and `-` at each strip's input. **Stripe to ground.**

---

# Part 4: bring-up

### 17. Flash

```sh
cd firmware/node
export WIFI_SSID='your-network' WIFI_PASSWORD='your-password'
cargo run --release
```

Default features. No `--features` flag, that is the frame build.

### 18. Last check before mains

- [ ] Chip pin 14 on **5 V**, not 12 V
- [ ] All three capacitor stripes on ground
- [ ] Every fuse fitted, correct rating
- [ ] All 8 injection points have **both** conductors
- [ ] Each data pair has its own ground
- [ ] Weep hole drilled, glands down, desiccant in
- [ ] Nothing bare, nothing touching

### 19. Switch on and watch the selftest

| Step | Should be |
|---|---|
| 1 | **Line A red** *(N and E light)* |
| 2 | **Line B green** *(S and W light)* |
| 3 | **Line C blue** *(beam lights)* |
| 4 | One dot travels each line at once |

A wrong colour on a run means the data pairs are swapped. A dot that stops partway is where that
line breaks.

### 20. Verify under load

Point the app at region **Whole room**, 720 px. Run a bright track.

| Measure | Want |
|---|---|
| Volts at the **furthest** injection point | **11.5 V or more** |
| `led` on the stats line | **~12300 us** |
| `torn`, `oob`, `bad` | 0 |

If `led` reads about 29000, the three lines are not running together and something is wrong with
the join. If the far corner reads under 11 V, add a fourth feed to that reel.

---

## If something is wrong

| Symptom | Cause |
|---|---|
| One run dark, others fine | That line's fuse, or its data pair |
| A run's far half goes orange | Starved. **Not** data. Add a feed |
| Whole fixture dark, board reports fine | Level shifter unpowered, or its enable pin floating |
| Random glitches, worse when wet | Data pairs sharing a ground, or water in the box |
| Glitches that came on after months | Corroded joint, or the breadboard you meant to replace |
| Fuse blows on one reel only | Short in that run. Do not fit a bigger fuse |
| `led` ~29000 us | Lines running in sequence, not together |
| Colours right, brightness uneven between reels | One reel missing its middle feed |

---

## Once it runs

- Measure a **full white frame** at the supply and write the number down. Every fuse and cable
  choice above assumes 16.5 A, and yours is now a measurement rather than an estimate
- Set `TRIM[3]` in `fixture/rgbww.rs` from what the room looks like, not from a bench frame
- Change the desiccant each spring, and check the weep hole is clear
