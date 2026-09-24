# LightningStrike R2 engineering review

R2 supersedes the R1 design discussed in MANUFACTURING.md. No boards have been built,
and no supplier has approved an order. See release-status.json for the current release gate.
The editable master is index.circuit.tsx, its imports, storm-crest.tsx and saved routing.
Firmware is intentionally unchanged; root HARDWARE.md documents the migration.

## Final digital verification — 21 September 2026

- 266/266 independent electrical/CAD contract checks pass.
- Freerouting checks final exported copper: zero open connections and zero clearance violations.
- TypeScript, netlist, placement and short-circuit checks pass.
- No via hole violates the 0.10 mm hole-edge clearance to a solderable SMT land.
- USB and crystal signal paths stay on the top layer without vias.
- Final top/bottom artwork and assembly apertures were visually reviewed.
- Exported ground-plane antipads isolate all 111 signal vias; all 16 ground vias connect
  on both ground planes. Neither mask layer includes via-centered openings.

Reports and release-status.json record the exact circuit SHA-256. The prototype ZIP contains
Gerbers, drill files, exact-MPN BOM, CAD placements, assembly drawings and the check reports.
Supplier DFM/impedance/assembly review and powered prototype testing are still required.

The schematic style checker also ran. It reports 37 presentation advisories (symbol padding,
preferred orientation, shorter drawing traces and grouping decouplers across functional blocks).
These are recorded in schematic-review.log; they are not PCB overlap or connectivity findings.
The schematic preserves functional blocks and local decoupler associations. Its style checker
is not claimed to be warning-free.

## Engineering changes

| R1 finding | R2 correction |
| --- | --- |
| Long crystal input with vias | Local ABM8-272-T3, 15 pF capacitors and 1 kohm resistor; protected top-only routes |
| Independently routed USB with layer changes | Top-only USB-C → USBLC6 → 27 ohm resistors → RP2040; coupled main run; no signal vias |
| AHCT OE pulled to 3.3 V while powered at 5 V | 10 kohm pull-up to V5_OUT, AO3400A low-side sink, 100 kohm gate pulldown; GP5 high enables |
| Buck layout not constrained | Short, wider VIN/SW/output paths, local input bypass and ground vias, feedback away from SW |
| RP2040 core decoupling detours | Protected local paths to C16 and C18, explicit QFN ground and pin escapes |
| Default solder paste at about 49% pad area | Normal pads 95% linear aperture, RP2040 EP four windows at 65% area, radio islands at 72% area |
| Back without artwork | Original winged lightning spear, star, orbit and STORM CORE / R2 legend on bottom silkscreen |

The crystal courtyard is the pad/body envelope plus 0.25 mm. Imported decorative pin-one
graphics are not part of its mechanical envelope. Graphic silkscreen is trimmed to at least
0.20 mm from exposed pads; reference designators remain in the assembly drawings.
The face-on bottom preview is mirrored from CAD top-view coordinates so physical text is readable.

## USB stack-up and model

Intended stack-up: **JLC06121H-3313, six layers, 1.2 mm**, 1 oz outer copper and 0.5 oz inner.
L1 signal / L2 GND / L3 signal / L4 signal / L5 GND / L6 signal.
The L1-to-L2 3313 prepreg is nominally 0.0994 mm, dielectric constant 4.1.
The main differential run uses 0.15 mm width and 0.17 mm edge spacing (0.32 mm pitch).
Pads and short terminal escapes cannot retain the uniform transmission-line cross section.

scripts/usb-field-check.py independently solves a two-dimensional quasi-static odd-mode
cross section. The converged nominal estimate is about **92 ohms differential**;
dist/usb-field-check.json records mesh/domain convergence. It models rectangular 35 um copper,
mask Er 3.8, 30.48 um mask over substrate and 15.24 um over trace. It does not model etch shape,
connectors, ESD/MCU pads, bends, tolerances or a complete USB channel. This is not a vendor coupon
measurement or vendor approval. Specify **90 ohms differential, ±10%**, confirm this exact stack
and let the fabricator review/adjust the coupled geometry before fabrication. Recheck DRC if changed.

Sources: [JLCPCB stack-ups](https://jlcpcb.com/impedance),
[JLCPCB impedance calculator](https://jlcpcb.com/pcb-impedance-calculator),
[RP2040 hardware guide](https://datasheets.raspberrypi.com/rp2040/hardware-design-with-rp2040.pdf).

## Electrical and assembly review

scripts/review-electrical.mjs checks the built physical pin assignments against a separate
contract for RP2040, flash, ESP32, regulator, AHCT, FETs, protection and connectors. It also checks
critical component values, NCs, isolated OE control, preserved critical paths and paste windows.
The final report is tied to the circuit JSON SHA-256. Freerouting DRC checks exported final
copper, not just the pre-route netlist. Packaging rejects a changed circuit or any failed DRC.

The flash UX package is 2 × 3 mm, 0.5 mm pitch; its 1.7 × 0.3 mm PCB ground land accommodates
the nominal 1.6 × 0.2 mm exposed package paddle. Module ground islands 54–61 alias pad 49.
The ESP32 part must be ESP32-C3-MINI-1U-N4X, with an external 2.4 GHz antenna attached.
AO3400A is a new R2 BOM line and must not be substituted with the P-channel AO3401A input FET.
No filled microvias or via-in-pad processes are intended. Ground vias are outside paste lands.

The 22 uF output capacitors are 16 V X5R parts operating at 3.3 V. Nominal capacitance alone is
not a measured effective-capacitance guarantee; supplier DC-bias data and assembled load-step
testing remain necessary. The AP63203's 2 A rating does not override the input fuse/harness limits.
Review assembler stencil thickness, aperture reductions, exact part availability and every
polarized footprint/nozzle rotation before assembly approval.

Sources: [TI SN74AHCT125](https://www.ti.com/lit/ds/symlink/sn74ahct125.pdf),
[AO3400A](https://www.aosmd.com/sites/default/files/res/datasheets/AO3400A.pdf),
[AP63203](https://www.diodes.com/assets/Datasheets/AP63200-AP63201-AP63203-AP63205.pdf),
[Espressif module](https://documentation.espressif.com/esp32-c3-mini-1_datasheet_en.html),
[Winbond UX package drawing, manufacturer PDF mirror](https://www.pjrc.com/teensy/winbond_w25q16jvuxim.pdf).

## Required physical verification

1. Inspect solder joints, component orientation, shorts and unpowered rail resistance.
2. Power from a current-limited 5 V supply, LEDs disconnected. Check 3.3 V and 1.1 V, startup
   waveforms, radio-off reset state and OE high. Check both power sources separately and together.
3. Enumerate RP2040 ROM USB in both USB-C orientations. Verify BOOTSEL, reset, SWD and flash.
4. After the separately authorized firmware port, test UART radio recovery, WiFi selection,
   throughput and reconnect behavior with the actual antenna.
5. Scope A/B/C during reset, power removal, reconnect and firmware updates. Check 800 kHz
   waveform margins at the first LED through the actual harness and common ground bus.
6. Run a full-frame soak with WiFi bursts; measure regulator/diode temperatures, supply droop,
   radio resets and dropped frames. Hardware sign-off requires these measured results.

CAD checks can detect specified design errors; they cannot establish that an unbuilt board
will work in every operating condition. This report does not claim physical validation.
