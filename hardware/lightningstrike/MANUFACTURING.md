# Manufacturing review and delivered cost budget

**Historical R1 review.** R2 now passes its digital checks; see [R2-REVIEW.md](R2-REVIEW.md)
and [release-status.json](release-status.json) for current status. The budget below is still
indicative for the same size, six-layer construction and two-sided assembly; R2 adds two parts.
It is not a checkout quote for the revised BOM.

Reviewed 20 September 2026. Destination: Žiželice nad Cidlinou, Czechia, 281 29.

**HOLD: the current R1 must not be ordered.** This report records an engineering review and a
cost budget, not a fabrication release, an exhaustive electrical sign-off, or a supplier quotation.
No files were uploaded to a manufacturer, no vendor was contacted and no order was placed.
The circuit and firmware have not been changed by this review.

## Budget for the current size and construction

| Fully populated boards wanted | Indicative delivered budget | Per assembled board |
| --- | ---: | ---: |
| 3 | **8,000–12,000 CZK** | about 2,670–4,000 CZK |
| 5 | **8,500–13,500 CZK** | about 1,700–2,700 CZK |

These are deliberately rounded planning ranges for six-layer, 42 × 34 mm, 1.2 mm, black/ENIG,
two-sided SMT boards with the existing 77 placements and 29 unique BOM lines. They include
estimated component sourcing, assembly, shipping, 21% VAT, an import/clearance contingency,
and modest allowances for external antennas and mating JST leads. Accessories are not in
the PCB assembly BOM. Their exact part numbers and supplier still need selecting.

They **exclude firmware development, functional-test fixture/programming services, bench
equipment, enclosure, power supply and any second PCB revision**. This is a budget for populated
prototype hardware, not a promise of working, programmed LightningStrike controllers on arrival.
Final panelization, supply substitutions, postage, duties and currency conversion can change it.

Five boards make better economic sense because setup dominates. The three-board model assumes
five bare PCBs fabricated and three assembled; that quantity combination needs supplier confirmation.

### Estimate model

| Item | 3 assembled | 5 assembled | Evidence level |
| --- | ---: | ---: | --- |
| Five bare PCBs | $82–119 | $82–119 | Live geometry/options calculator; see qualifications below |
| Two-sided assembly, setups, stencil, fixtures and inspection | $140–195 | $140–195 | Published fees plus allowance; not a submitted assembly quote |
| Purchased components | $30–60 | $50–100 | $10–20 per board allowance; complete BOM not priced by assembler |
| Freight | $10–30 | $10–30 | Czech country rates observed for bare-board weight; assembled parcel pending |
| Subtotal before tax | $262–404 | $282–444 | Sum of above |

For conversion, use 21.238 CZK/USD (CNB, 18 September 2026) and provisionally multiply the
goods-plus-freight subtotal by 1.21 for VAT. Then allow 500–1,000 CZK per shipment for import,
clearance and exchange-rate uncertainty, plus 300–600 CZK (three) or 500–1,000 CZK (five)
for antennas/leads. This gives roughly 7,530–11,980 CZK and 8,250–13,410 CZK before the
table's upward rounding. The contingency is not a determination of the customs tariff for
an assembled controller; the carrier/vendor must confirm its classification and final charges.

Sources: [CNB exchange rates](https://www.cnb.cz/cs/financni-trhy/devizovy-trh/kurzy-devizoveho-trhu/kurzy-devizoveho-trhu/vybrane.html?do=31.12.2026&mena=USD&od=01.01.2026),
[Czech tax administration](https://financnisprava.gov.cz/cs/dane/danovy-system-cr/popis-systemu),
[JLCPCB EU customs information](https://jlcpcb.com/help/article/eu-customs-reform-faq).

### Observed pricing and limitations

The [JLCPCB calculator](https://cart.jlcpcb.com/quote) showed **$81.90** for five boards with
the above dimensions, six layers, 1.2 mm FR4 TG135, black mask, ENIG, 1 oz outer copper and
filled/capped vias, with optional four-wire Kelvin testing off. Its fee breakdown was $32 base,
$16.80 finish and $33.10 colour. The form's via selection for this comparison was 0.3 mm hole /
0.4–0.45 mm pad: **that is not the current design's exact 0.20/0.45 mm geometry**.

The fine-via choice (0.20 mm hole / 0.30–0.35 mm pad), TG155 and Kelvin option produced $118.60.
JLCPCB's [published capability rules](https://jlcpcb.com/capabilities/Capab) associate the extra
0.20/0.25 mm hole fee with pads below 0.45 mm. Current vias use 0.45 mm pads. Therefore the
lower fee is plausible but must be confirmed from the actual Gerbers; neither form selection
is an exact reviewed manufacturing quote. No PCB geometry was changed to obtain these prices.

[Published Standard assembly fees](https://jlcpcb.com/help/article/pcb-assembly-price)
give $51.12 double-sided setup, $16.42 stencil, $16.42 fixtures and $1.53 per feeder.
Assuming 29 feeder charges gives $128.33 before joint placement, inspection and other charges.
The CAD has approximately 317 solder features per board, giving about $1.52/$2.54 at
$0.0016 per joint for three/five boards. QFN/leadless inspection, split-side feeder accounting,
rails and source procurement require the actual quote. The conditional handling charge is
not automatically added as a mandatory fee in this model.

The board is below the [Standard assembly handling size](https://jlcpcb.com/capabilities/pcb-assembly-capabilities);
factory panel/rail arrangements must be confirmed. The assembly form required a Gerber upload
before proceeding, so there is **no complete BOM/CPL assembly quote** behind this estimate.

Sample component checks: [RP2040 at JLCPCB](https://jlcpcb.com/partdetail/RaspberryPi-RP2040_RP2B2/C2040)
was $0.9896 at quantity one; the exact [ESP32-C3-MINI-1U-N4X at DigiKey](https://www.digikey.com/en/products/detail/espressif-systems/ESP32-C3-MINI-1U-N4X/27525543)
was $3.38 at one and $2.921 at ten. These do not establish the assembler's landed sourcing price.
In particular, the radio supplier field is intentionally empty; do not silently substitute the older N4.

For Czech Republic, the calculator displayed EuroPacket $9.28 (5–9 business days) and DHL
Express $21.93 (2–4 business days), at a bare-board shipment weight of 0.14 kg. Those are
transit estimates after production. The $5.33 Global Standard Direct option had a $150 order
limit and is not budgeted for this assembled batch. The DHL DDP freight figure was also $21.93,
but this did not include a finalized tax/duty checkout. No full street address or postcode-specific
delivery surcharge was quoted. Assembly sourcing and production add time beyond these transit estimates.

## Engineering findings that block ordering

The reviewed circuit SHA-256 is recorded in [release-status.json](release-status.json).
[routing-audit.json](routing-audit.json) contains measurements from the actual routed CAD.
Net lengths below sum all branches; they are not end-to-end signal lengths or measured pair skew.

1. **Crystal input routing:** XIN has 18.032 mm total routed copper and two through-vias, using
   top and inner3. XOUT and XTAL_OUT remain on top. Move/reroute the oscillator network locally,
   minimize parasitics and review load capacitance before rebuilding the package. The selected
   crystal, 15 pF capacitors and 1 kohm damping resistor follow the reference circuit, but those
   values alone do not validate the current layout.
2. **USB routing:** USB_DP has three vias and USB_DM two, with both using top, inner2 and bottom.
   They were independently routed without a vendor-controlled 90 ohm differential stack-up.
   Route a coupled pair with consistent transitions and uninterrupted reference ground; verify
   the impedance against the chosen laminate construction. The short MCU-to-series-resistor
   segments are not sufficient to validate the rest of the path.

These are layout risks, not proof that every board will fail. They fall short of the margin
needed to call this design ready. See Raspberry Pi's [RP2040 hardware design guide](https://datasheets.raspberrypi.com/rp2040/hardware-design-with-rp2040.pdf),
crystal and USB sections.

3. **Output enable during power sequencing:** R8 pulls LED_N_OE to V3V3, while U5 runs from
   V5_OUT. The 5 V rail can arrive while 3.3 V is absent, so the claimed default-disabled state
   is not assured. Use an OE pull-up in U5's supply domain and a 3.3 V-safe transistor/control
   stage with a defined off state. Never connect a 5 V pull-up directly to the RP2040 GPIO.
   Recheck the firmware enable polarity and reset behavior after the hardware revision.
   [TI's SN74AHCT125 datasheet](https://www.ti.com/lit/ds/symlink/sn74ahct125.pdf) recommends
   an OE pull-up to its own VCC for high impedance during power transitions.
4. **Power and manufacturing review remains open:** check buck switching/input-current loops,
   local decoupling and actual capacitor bias derating, thermal paths, USB shell slots, exposed-pad
   paste apertures and every polarized placement. Resolve panel handling and assembler rotations.
   Digital DRC does not cover these. Use the [AP63203 datasheet](https://www.diodes.com/assets/Datasheets/AP63200-AP63201-AP63203-AP63205.pdf)
   as the power-layout reference. Then rerun all existing digital checks on the revised circuit.

The pin/net review found no obvious mismatch in RP2040 supplies/flash, radio SPI/boot pins,
three data-only connector circuits, AHCT pin allocation, or the input protection diode/MOSFET
orientation. This limited review is not a claim that every connection and footprint has passed
an independent professional sign-off. J2 still has exactly A/B/C and no ground circuit.

## What establishes that it actually works

Before ordering a prototype, close the hardware items above and obtain supplier DFM/BOM/CPL
approval. Before declaring the design functionally validated, test a physical first article:

- Current-limited power-up from J1 and USB separately; check 3.3/1.1 V, startup, ripple,
  reverse-current paths and regulator temperature during WiFi activity.
- Oscillator startup over repeated power cycles, USB enumeration in both cable orientations,
  BOOTSEL/recovery, flash access and reset behavior.
- Program and test the RP2040/ESP32-C3 firmware, radio reset/straps, external antenna connection,
  reconnect/selection button and sustained transfer.
- Scope all three 5 V outputs, including power-up/down and USB-only states; exercise them with
  the real frame wiring, common ground and strip loads.

Firmware remains deliberately unchanged under the user's instruction. The existing Pico W
application does not provide the new ESP32-C3 WiFi backend. Fully populated boards therefore
cannot yet be promised as ready-to-use application controllers.

[PCBWay offers functional testing](https://www.pcbway.com/pcb_prototype/PCB_Assembly_Functional_Testing.html)
as a separately quoted service using customer firmware, test instructions and any required fixture.
AOI, X-ray and bare-board electrical tests inspect manufacturing quality; they do not replace
these functional tests. No PCBWay full-assembly quote was obtained, so no competing price is invented here.

Recommendation: revise the design first, then obtain a turnkey quote for five, and make a
tested prototype the gate for subsequent production. A second revision may still be necessary.
