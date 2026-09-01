# Demo wiring: 5 m of SK6812

One reel, one data line, powered from a PC supply. No soldering on the strip.

Four parts, about an hour. **Build the power side first and measure it before the strip is anywhere near it.**

---

## Parts

- [ ] SK6812 RGBWW reel, 5 m
- [ ] Raspberry Pi Pico W + USB cable
- [ ] SN74HCT125N
- [ ] Breadboard + jumper wires
- [ ] 330 ohm resistor
- [ ] 100 nF ceramic capacitor
- [ ] 1000 uF / 25 V capacitor
- [ ] 5 x WAGO 221-413
- [ ] Fuse holder KLS5-708B + **5 A** fuse
- [ ] Silicone wire 1.5 mm2, red and black
- [ ] Thin wire for the breadboard, solid core or tinned
- [ ] Multimeter

## Three rules

1. **12 V never touches the breadboard.** It melts above about 1 A.
2. **Ground first, then +12 V, then data.** Every time.
3. **Unplug from the wall before changing anything.**

---

# Part 1: the power side

Nothing else is connected yet. No strip, no chip, no Pico.

### 1. Wire the five WAGOs

Your Molex has four wires: **1 yellow, 2 black, 1 red.** All four get used.

Lift the orange lever, push the stripped wire in, close the lever. Tug it to check.

| WAGO | Put in |
|---|---|
| **A** | Molex **yellow** · fuse holder wire *(either one)* |
| **B** | fuse holder **other** wire · **red 1.5 mm2** *(to strip)* |
| **C** | Molex **black #1** · **black 1.5 mm2** *(to strip)* |
| **D** | Molex **black #2** · thin wire *(to breadboard)* |
| **E** | Molex **red** · thin wire *(to breadboard)* |

Leave one free port on **B** and one on **C**. The big capacitor goes there in Part 3.

Put **B** and **C** side by side so the capacitor legs can reach both.

### 2. Fit the 5 A fuse

Into the holder. Not the 10 A. The 10 A is for later, when you feed both ends.

### 3. Measure before you trust it

Power on. Probe with the black lead on WAGO **C**:

| Red lead on | Should read |
|---|---|
| WAGO **B** *(the red strip wire)* | **~12 V** |
| WAGO **E** *(the thin wire)* | **~5 V** |
| WAGO **D** | **0 V** |

**If anything is wrong, stop and fix it now.** This is the last moment where a mistake costs nothing.

### 4. Power off. Unplug.

---

# Part 2: the breadboard

### 5. Feed the rails

| From | To breadboard |
|---|---|
| WAGO **E** | **+** rail |
| WAGO **D** | **-** rail |

> Thin stranded wire will not hold in a breadboard hole. Use solid core, or melt a little solder onto the end first.

### 6. Measure the rails

Power on. **+ rail must read 5 V, not 12 V.** Power off and unplug.

### 7. Seat the chip

Across the middle groove of the breadboard. **Notch facing up.**

Pin 1 is top-left. Numbers run **down** the left side, then **up** the right side.

```
        notch
      +--\__/--+
   1 -|        |- 14
   2 -|        |- 13
   3 -|        |- 12
   4 -|        |- 11
   5 -|        |- 10
   6 -|        |-  9
   7 -|        |-  8
      +--------+
```

### 8. Wire the chip

| Pin | Goes to |
|---|---|
| **14** | **+** rail *(5 V)* |
| **7** | **-** rail |
| **1** | **-** rail |
| **4, 5, 9, 10, 12, 13** | **-** rail |
| **2** | Pico **pin 4** *(GP2)* |
| **3** | one leg of the **330 ohm** resistor |
| 6, 8, 11 | nothing |

Pin 1 grounded is what switches the chip on. Miss it and nothing comes out.

### 9. Add the small capacitor

**100 nF** between pin **14** and pin **7**. As close to the chip as you can get it. No polarity, either way round.

### 10. Ground the Pico

| From | To |
|---|---|
| Pico **pin 3** *(GND)* | **-** rail |

Pin 3 sits right next to pin 4, which makes it easy to find and easy to forget. **It is the wire that makes everything work.**

---

# Part 3: the strip

### 11. Find the input end

Look for a small **arrow** printed along the strip. Data flows the way it points.

**Connect at the tail of the arrow, not the head.** The pads there say `DI` or `DIN`. The other end says `DO` and will do nothing.

If the reel's wires end in a plug, snip it off and strip 10 mm.

### 12. Connect, in this order

| Order | Strip wire | Into |
|---|---|---|
| 1st | white or black *(GND)* | WAGO **C** |
| 2nd | red *(+12 V)* | WAGO **B** |
| 3rd | green *(data)* | free leg of the **330 ohm** resistor |

### 13. Fit the big capacitor

**1000 uF**, into the free ports you left:

| Leg | Into |
|---|---|
| **striped** leg *(minus)* | WAGO **C** |
| plain leg *(plus)* | WAGO **B** |

**The stripe marks minus.** Backwards, it explodes.

If the legs are too short to reach, skip it for now. It is protection, not a requirement.

---

# Part 4: flash and watch

### 14. Flash the Pico

Hold **BOOTSEL**, plug the Pico into USB, then:

```sh
cd firmware/node
export WIFI_SSID='your-network'
export WIFI_PASSWORD='your-password'
cargo run --release --no-default-features --features bench
```

Watch the console in another terminal:

```sh
screen /dev/tty.usbmodem* 115200
```

### 15. Last check before power

- [ ] Chip pin 14 on **5 V**, not 12 V *(12 V kills it instantly)*
- [ ] Capacitor stripe on the **C** side
- [ ] Nothing carrying 12 V through the breadboard
- [ ] Fuse in the **red** path, not the black
- [ ] Ground reaches **both** the strip and the Pico
- [ ] No bare wires touching

### 16. Switch on. Write down what you see.

The strip runs four tests, then goes dark and joins WiFi.

| # | What happens | Write down |
|---|---|---|
| 1 | Four colours, 1.5 s each | the **order** of the colours |
| 2 | Dotted ruler, 4 s | **bright marks per metre**: 3 or 1 |
| 3 | One dot travels the strip | where it stops, if it does |
| 4 | White, then white again | which one is **brighter** |

### 17. Set four constants

Edit `firmware/node/src/fixture/bench.rs`:

| You saw | Change |
|---|---|
| green, red, blue, white | nothing, that is the default |
| any other order | `SLOTS` |
| 1 bright mark per metre | `ADDRESSES` to `100` |
| second white much brighter | lower `TRIM[3]` |

Reflash. **Done.**

---

## If something is wrong

| Symptom | Cause |
|---|---|
| Nothing lights | Pico ground not shared, or chip pin 1 not grounded |
| Only the first LED lights | Data not reaching the strip |
| Nothing, and the strip looks fine | Wrong end. Move to the `DI` end |
| Random flicker | Chip not powered, or a loose rail wire |
| Far end goes orange on step 4 | Normal with one feed. Ignore |
| Colours scrambled | `SLOTS` wrong, see step 17 |
| Fuse blows at once | Short. Unplug, recheck step 15 |
| Chip gets hot | 12 V reached pin 14. It is dead, fit another |

---

## Later, not now

- Feed +12 V **and** ground at **both** ends of the strip
- Swap the 5 A fuse for the 10 A
- Point the app at it: hardware panel, frame device, region **Frame N**
