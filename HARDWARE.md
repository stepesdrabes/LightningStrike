# LightningStrike controller PCB

The design source is [`hardware/lightningstrike/index.circuit.tsx`](hardware/lightningstrike/index.circuit.tsx).
This replaces the Pico W and separate level-shifter assembly in
[`docs/frame-wiring.md`](docs/frame-wiring.md). It does not carry the strip's 12 V power.

**R2 engineering revision; release status is recorded in
[release-status.json](hardware/lightningstrike/release-status.json).**
R1 is obsolete and must not be ordered. R2 revises the crystal, USB, power loops and output-enable
circuit and adds original back silkscreen artwork. Read the [R2 review](hardware/lightningstrike/R2-REVIEW.md)
for checks and remaining fabrication/physical validation gates. The earlier
[manufacturing estimate](hardware/lightningstrike/MANUFACTURING.md) remains a budget, not a vendor quote.
No board has been physically built or tested. No firmware has been changed;
the existing Pico W image cannot operate this ESP32-C3 radio.

The [R2 prototype review package](hardware/lightningstrike/dist/lightningstrike-r2-prototype.zip)
contains the manufacturing and assembly exports. R2 passes 266 electrical/CAD checks and final
independent routing DRC with zero opens or clearance violations. This is an unbuilt prototype;
supplier approval and the physical tests in the R2 review are required before functional release.

## Design

- Bare RP2040, 12 MHz crystal, 2 MB W25Q16JV flash.
- ESP32-C3-MINI-1U-N4X radio module with external antenna connector. The RP2040 is not a module.
  Use a 2.4 GHz, 50 ohm antenna with the mating connector specified by Espressif. There is no
  onboard antenna; attach the external antenna before enabling radio transmission.
- 42 x 34 mm rounded PCB, black solder mask, white silkscreen, ENIG finish intended.
- Six copper layers, 1.2 mm FR4, top and bottom component assembly. Layer order is
  top signal / ground / signal / signal / ground / bottom signal. Both ground layers are
  reserved from signal routing. The extra layers keep the compact layout and ground references.
- Locking JST GH connectors: two circuits for power and three circuits for data.
- Three SN74AHCT125 outputs with 150 ohm source resistors and PESD5V0S1BLN ESD protection.
- Dedicated WiFi selection button, RP2040 BOOTSEL and reset buttons, status LED, service pads.
- AP63203 3.3 V buck regulator. The 2 A regulator rating is not the board's input current rating.

The recommended N4X radio uses the same module land pattern as the N4 geometry imported into
tscircuit. Procurement must specify **ESP32-C3-MINI-1U-N4X**, not the older N4 import's supplier
code and not the antenna-on-PCB MINI-1. Its supplier field is deliberately empty.

The nine solder islands belonging to radio pad 49 have unique CAD identifiers 49 and 54-61.
All nine connect to ground; 54-61 are CAD aliases, not additional manufacturer pins.
The PCB has no mounting holes. Use a carrier with edge support and clearance below the bottom
components; do not place it directly on a conductive frame. Allow access to the antenna cable
and USB plug, and strain-relieve both cable harnesses.

## Wiring

| Connector | Physical circuit | Function |
| --- | --- | --- |
| J1, BM02B-GHS-TBT | 1 | Regulated +5 V input |
| J1 | 2 | Fixture ground bus |
| J2, BM03B-GHS-TBT | 1 | A: GP2, frame N + E |
| J2 | 2 | B: GP3, frame W + S |
| J2 | 3 | C: GP4, beam |

J2 has **no ground circuit**. Its two mechanical hold-down pads are not extra connector circuits.
Use the manufacturer's circuit numbers when crimping: do not infer pin order by looking at the
wire side of a plug. Mating housings are GHR-02V-S and GHR-03V-S; contacts are SSHL-002T-P0.2.
Use 26 AWG flexible leads and strain relief. These connectors power only the controller.

Keep one ground conductor alongside each data conductor in its twisted pair. Terminate those
three returns at the fixture ground bus beside the controller. Connect J1 ground to that same
bus with a short lead. Omitting ground from J2 does not remove the signal-return requirement.
Retain the existing strip power branches, fuses and local strip capacitors.

The intended input is 4.75 to 5.25 V at J1, with a 1 A capable source. F1 is a 750 mA hold
resettable fuse; its trip current is higher and temperature-dependent. Q1 protects against reversed
polarity. Neither is protection against connecting the 12 V strip supply.

J3 USB-C powers the controller through a Schottky diode. Another diode feeds the controller from
J1, isolating the two sources. The output buffer receives the protected J1 rail **before** these
diodes, retaining a proper 5 V output. USB alone is for programming and diagnostics; J1 must be
powered to drive LEDs. Keep the radio off until external power is detected or USB has granted an
adequate current budget. Do not count on the USB connector alone to negotiate higher current.

## Firmware migration, deliberately not implemented

Add a separate board feature, for example `lightningstrike-r2`, while retaining the existing Pico W
target. Keep fixture geometry, byte order, reversal, frame timing and persistence layout unchanged.
Preserve the 2 MB flash map shared by `firmware/boot` and `firmware/node`.

| RP2040 GPIO | R2 connection | ESP32-C3 GPIO |
| --- | --- | --- |
| 2, 3, 4 | LED A, B, C inputs | - |
| 5 | Output enable through Q2, **active high** | - |
| 10 | SPI1 clock, 33 ohm termination | 6 |
| 11 | SPI1 MOSI, 33 ohm termination | 7 |
| 12 | SPI1 MISO, 33 ohm termination at radio | 3 |
| 13 | SPI1 chip select, active low | 10 |
| 14 | Radio data-ready input | 4 |
| 15 | Radio handshake input | 5 |
| 16 | Radio enable through 1 kohm, active high | EN |
| 17 | Radio boot strap, normally released | 9 |
| 18 | WiFi button, active low | - |
| 19 | USB VBUS presence via 100k/100k divider | - |
| 20 | External 5 V presence via 100k/100k divider | - |
| 25 | Green status LED, active high | - |

The old GP23/24/25/29 CYW43 interface does not exist here. GP25 now drives the status LED
directly. Keep PIO1 SM0-2 and DMA_CH2-4 for the three LED outputs. PIO0 is released by the radio
change; SPI1 can use the DMA channels that CYW43 previously occupied, with a second channel
assigned for simultaneous receive/transmit. Check ownership against settings flash and USB.

Use an ESP-Hosted-style raw Ethernet transport so `embassy-net`, HTTP, DDP, DHCP and the existing
application remain on RP2040. This is a porting task, not a replacement call to `cyw43::new`:

1. Pin a compatible ESP-IDF and ESP-Hosted protocol version. Build the ESP32-C3 slave firmware
   for the exact GPIO table above. MISO is deliberately GPIO3, avoiding boot strap GPIO2.
   Configure data-ready GPIO4 and handshake GPIO5 explicitly rather than assuming defaults.
2. Implement the host SPI framing, flow control, control messages and Ethernet device interface
   in Rust. An Embassy driver must handle RX buffer ownership, queue pressure, link state,
   retries and radio reset. Establish the protocol's SPI mode from the pinned slave version;
   start at a conservative clock, then measure reliable throughput.
3. Port network selection and reconnection from `firmware/node/src/net.rs`. Keep the existing
   debounce and selection logic in `select.rs` and `firmware/wifi`. Preserve one press per
   network advance and persistent index behavior. Replace `cyw43` LED calls with GP25.
4. On reset, keep GP5 low, GP16 low, SPI CS high and GP17 high impedance. Once power is stable,
   release/drive GP17 high, enable GP16 and wait for slave readiness. GPIO2, GPIO8 and GPIO9
   have hardware pull-ups on the radio. Never hold GPIO9 low during a normal radio reset.
5. Start PIO outputs low before driving GP5 high. Enable outputs only when GP20 indicates the
   fixture rail is present. Return GP5 low on a fixture-power fault. R32 holds Q2's gate low
   while RP2040 is in reset; R8 pulls the AHCT enable pins to their own 5 V supply. Q2 sinks
   those pins when GP5 is high, keeping 5 V away from the RP2040 pin. This reverses the old
   R1 software polarity. Verify startup and shutdown behavior on an assembled prototype.
6. Use GP19 for USB cable detection and self/bus-powered behavior; comply with the available
   USB current budget before enabling WiFi. The radio EN pulldown keeps it off in RP2040 ROM
   boot mode. GP16 drives EN through 1 kohm; EN also has 100 kohm to ground and 100 nF.
7. Revalidate bootloader, USB recovery and OTA rollback on R2. Replace CYW43 firmware blobs only
   in the R2 build, and retain Pico W support. Implement separate radio firmware update/recovery.

At 671 RGBW addresses and 60 frames/s, raw pixel payload alone is 161,040 bytes/s, or 1.288 Mbit/s.
Allow margin for Ethernet, DDP and SPI framing, commands and retransmissions. A 115200 baud UART
link is insufficient. The service UART is for flashing/debugging, not the planned frame transport.

## Recovery and bring-up

| Pad | Signal | Pad | Signal |
| --- | --- | --- | --- |
| TP1 | GND | TP7 | GND |
| TP2 | 3.3 V reference | TP8 | ESP UART RX, GPIO20 |
| TP3 | Protected fixture 5 V | TP9 | ESP UART TX, GPIO21 |
| TP4 | RP2040 1.1 V core | TP10 | ESP EN |
| TP5 | RP2040 SWCLK | TP11 | ESP BOOT, GPIO9 |
| TP6 | RP2040 RUN | TP12 | RP2040 SWDIO |

For RP2040 USB recovery, hold BOOTSEL and press/release reset; release BOOTSEL after enumeration.
For SWD use TP1/2/5/6/12, treating TP2 as a voltage reference rather than a second power source.

For ESP UART recovery, use a 3.3 V logic adapter, common ground, adapter TX to TP8 and RX to TP9.
Hold RP2040 in reset at TP6 so it cannot contend on EN or BOOT. Hold TP11 low, apply 3.3 V to TP10
through a 1 kohm jig resistor, then release TP11 after entering download mode. Do not supply 5 V
to any service GPIO. Power the board normally; do not power it through UART signals.

First power-up uses a current-limited 5 V bench supply with strips disconnected. Verify polarity,
3.3 V, 1.1 V, radio held off, output enable high and USB enumeration. Verify no backfeed into J1
with USB-only power, and no backfeed into USB VBUS with J1-only power. Then test the radio firmware,
antenna, WiFi button, status LED and reconnect behavior.

Before connecting the frame, scope A/B/C at startup, reset, WiFi changes and firmware update.
Check 800 kHz pulse timing at the first LED using the actual twisted-pair harness. Run the existing
five-region self-test, then a full-frame soak while measuring 3.3 V droop, regulator temperature,
throughput and frame counters. Verify the initial output-enable state and unplug/replug behavior.

## Local tools

```powershell
cd hardware/lightningstrike
npm ci
npm run typecheck
npm run netlist
npm run schematic
npm run placement
npm run build
npm run shorts
npm run assembly
npm run check:routes
npm run export
npm run dev
```

Install Node.js first; Bun and tscircuit are project-local dependencies. The scripts put the local
Bun executable on PATH. Generated previews and circuit JSON are in `dist/index`. No account or publishing is
required. Source imports retain the imported pad geometry; visual silkscreen and semantic pin
labels have been corrected locally. Automatic part substitution is disabled during the build.

`routing.json` contains the saved copper used by the local viewer and builds. The saved router
rejects changed pad positions, so placement edits cannot silently retain stale tracks.
`critical-routes.json` and `critical-vias.json` reserve reviewed clock, USB, buck and local
decoupling routes before autorouting. Regenerate them with `node scripts/critical-routes.mjs`
after a placement build. `npm run build` also applies the reviewed paste apertures and clips
graphic silkscreen away from solderable pads; raw tscircuit exports alone omit those adjustments.

To reroute after a geometry change, run `npm run route` in PowerShell with Java 25 or later.
The script downloads a checksum-pinned Freerouting 2.4.1 JAR, exports the physical pad geometry,
routes the four signal layers, runs the router's DRC, and imports the resulting SES into tscircuit.
It stops if connections or DRC findings remain. Run the normal tscircuit checks afterward.
The custom DSN exporter preserves individual pad sides/orientations and USB nonplated-hole
keepouts; the bundled exporter incorrectly combined some equal-size footprints in this design.
`npm run check:routes` independently checks the final saved copper, including the protected USB
segments. `npm run export` packages Gerbers, BOM, CAD placements, assembly drawings, schematic,
circuit JSON, 3D model, preview and validation report. Both commands run in PowerShell on Windows;
the independent routing check also requires Java 25 or later.

The tscircuit source and circuit JSON are authoritative. The experimental KiCad exporter currently
loses the schematic sheet and defaults to a different board thickness, so its output is deliberately
excluded from the deliverable package.

Assembly CSVs are generated in `dist/assembly`. `placement-cad.csv` uses the board center as
origin and the top-view coordinate frame for both sides. These are CAD rotations: the assembler
must verify reel/nozzle orientation and polarized components against the assembly drawing.
The BOM excludes test pads and lists the radio by its exact N4X manufacturer part number.

Use 0.15 mm minimum signal tracks/clearance, 0.45 mm via pads and 0.20 mm finished via drills.
All vias are through vias with tented outer openings; no blind, buried or filled microvias are
intended. USB shield holes are plated slots; the two USB locating holes are nonplated. Use ENIG
and white silkscreen on black mask. Confirm the selected fabricator's six-layer 1.2 mm stack-up
and USB differential impedance before releasing an order. USB full-speed signal integrity,
power transients and antenna performance still require physical prototype validation.

## Design references

- [RP2040 hardware design](https://datasheets.raspberrypi.com/rp2040/hardware-design-with-rp2040.pdf)
- [RP2040 datasheet](https://datasheets.raspberrypi.com/rp2040/rp2040-datasheet.pdf)
- [ESP32-C3-MINI-1/1U datasheet](https://www.espressif.com/sites/default/files/documentation/esp32-c3-mini-1_datasheet_en.pdf)
- [ESP-Hosted source and porting documentation](https://github.com/espressif/esp-hosted-mcu)
- [AP63203 regulator](https://www.diodes.com/assets/Datasheets/AP63200-AP63201-AP63203-AP63205.pdf)
- [SN74AHCT125](https://www.ti.com/lit/ds/symlink/sn74ahct125.pdf)
- [JST GH connector drawing and mating parts](https://www.jst-mfg.com/product/pdf/eng/eGH.pdf)
- [tscircuit CLI](https://github.com/tscircuit/cli)
