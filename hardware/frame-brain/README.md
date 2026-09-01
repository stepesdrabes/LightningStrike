# The Frame brain board

The soldered replacement for the perfboard in `docs/frame-wiring.md` step 11: a 80 x 68 mm
two-layer carrier that holds the Pico W on headers, the SN74HCT125N behind it, and screw
terminals for power in and four data pairs out. Everything else in the S-BOX (strip fusing,
power injection, the ground bus) stays on WAGOs exactly as the wiring doc describes; only
logic power and data live here.

## What it assumes

- **5 V comes straight from the salvaged PC supply.** There is no 12 V and no buck on this
  board. The wiring doc's LRS-350-12 plus buck arrangement predates this decision.
- Strip current never flows through this board or its ground.
- Lines A/B/C are GP2/GP3/GP4, matching `firmware/node/src/fixture/frame.rs`. Line D is the
  fourth buffer wired to GP5 and its own terminal as a spare, same philosophy as fuse 4: a
  dead line or a split reel means re-terminating a pair, not ordering a new board. Using it
  needs a fourth line added in the firmware.

## Terminals

| Block | Carries | Pins |
|---|---|---|
| J1 `5 V in` | supply | + left, - right, marked on silk |
| J2 `A north+east` | data pair, reel 1 | signal left, pair ground right |
| J3 `B south+west` | data pair, reel 2 | signal left, pair ground right |
| J4 `C beam` | data pair, beam | signal left, pair ground right |
| J5 `D spare` | data pair, unused | signal left, pair ground right |

One twisted pair per line, each with its own ground, as in the wiring doc.

## Protection, and why each part is there

- **F1, 1 A polyfuse.** The PC supply can source tens of amps; the fuse is for the feed wire.
- **D2 across the input.** A reversed supply trips F1 instead of killing anything.
- **D1, 1N5817 into VSYS.** A laptop on the Pico's USB cannot back-feed the 5 V rail. The
  Pico sees about 4.7 V, well inside its 1.8 to 5.5 V VSYS range.
- **C1, 1000 uF.** The WiFi transmit bursts land at the end of a long 5 V feed.
- **C2, 100 nF** tight against the shifter's pin 14.
- **SW1** pulls RUN low: hold BOOTSEL on the Pico and tap it to reach the bootloader without
  touching the supply.
- **D3** says the 5 V rail is up, which is the first thing to check when a line goes dark.

## Bill of materials

| Ref | Part | Note |
|---|---|---|
| J1 to J5 | Phoenix MKDS 1,5/2-5,08 | 5.08 mm screw block; KF301-5.08 clones fit the same footprint |
| U1 | Raspberry Pi Pico W | owned; add 2x 20-pin female header, 2.54 mm |
| U2 | SN74HCT125N | owned; add a DIP-14 socket, it is the replaceable part |
| F1 | Bourns MF-RHT100 | radial polyfuse, 1 A hold |
| D1, D2 | 1N5817 | DO-41 Schottky |
| D3 | LED 3 mm green | |
| R1 to R4 | 330 R axial | owned |
| R5 | 1k axial | |
| C1 | 1000 uF 25 V radial | owned, 10 mm can, 5 mm pitch |
| C2 | 100 nF ceramic | owned, 5 mm pitch |
| SW1 | 6 x 6 mm tactile | |
| H1 to H4 | M3 screw + standoff | mounts to the S-BOX plate |

## Ordering

`fab/frame-brain-revA-gerbers.zip` uploads as is to PCBWay, JLCPCB or Aisler: 2 layer,
1.6 mm, any finish. The design uses 0.5 mm tracks and 0.25 mm clearances, far inside every
fab's default capability, so the cheapest option is fine.

## Assembly

Solder flat to tall: R1 to R5, D1 and D2 (band toward the top edge, marked on silk), the
DIP socket, F1, C2, D3, SW1, the two header strips, C1 (stripe to the right, minus), then
the terminal blocks. Leave the chip and the Pico out.

Power on and check: LED lit, 5.0 V across C1, 5 V on socket pin 14 to pin 7. Power off,
seat the chip (notch toward pin 1 dot) and the Pico (USB toward the board edge), then carry
on with `docs/frame-wiring.md` part 4.

## Regenerating the design

`tools/gen_sch.py` writes the schematic and the project symbol library;
`tools/gen_pcb.py`, run with KiCad's bundled python, writes the routed board;
`tools/check_net.py` proves the extracted netlist matches the intended pin map. Editing the
files in KiCad directly is fine, but rerunning a generator overwrites its output.

ERC runs clean with one deliberate override in the project file: `pin_not_driven` is
ignored, because the only net that trips it is RUN, which the Pico drives through an
internal pull-up that ERC cannot see.
