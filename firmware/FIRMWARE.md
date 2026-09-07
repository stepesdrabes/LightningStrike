# Firmware

Two boards that are lights first and fixtures second. Each remembers its colour, brightness and
effect in flash, fades back into them when power returns, and answers a small HTTP API, so a
phone needs nothing but the address. The moment LightningStrike starts streaming DDP at one, it
hands its pixels over; a couple of seconds after the stream stops, it fades back to whatever it
was before the party. Source is in `firmware/`.

| binary | board | fixture | pixels | output |
|---|---|---|---|---|
| `room-node` (`frame`, default) | Pico W | **The Frame**, 3 x 2 m of SK6812 RGBWW at 60 LED/m | 720 | three PIO data lines on GP2, GP3 and GP4 |
| `room-node` (`bench`) | Pico W | **The bench run**, 5 m of SK6812 RGBWW on a table | 300 | one PIO data line on GP2 |
| `room-lamp` | ESP32-C3-Zero | **The Bounce Lamp**, a salvaged analog RGBW strip | 1 | four LEDC PWM gates on GPIO3-6 |

## The light

The engine (`firmware/light/src/engine.rs`) is one state machine, identical on both boards:

- **Smart** is the standalone life. On means the remembered effect - `wash`, `twinkle` or
  `fire` on the frame, `wash` on the lamp - tinted by the remembered colour and brightness.
  Soft-off fades out over half a second and is saved to flash immediately, because off is the
  state a power cut must find. Turning on fades in over 1.2 s.
- **Party** is entered by DDP arriving, never by hand, and it overrides a soft-off: start the
  stream and every fixture joins. Two seconds of stream silence - longer than any stall the
  radio has been measured to produce - fades the last frame the room actually showed down over
  400 ms, then the remembered state back up. An explicit off over the API during a party mutes
  that one fixture until it is turned back on; every other change during a party lands silently
  in the remembered state.
- **Power-on policy** is per fixture and per settings. The lamp ships `always-on`: it lives on
  a wall switch and flipping it must make light. The frame ships `restore`: it hangs there all
  year and a midnight power blip must not relight it.

Colour runs one way: perceptual values decode through a committed 2.45 LUT into linear light,
every fade and multiply happens linear, and the fixture quantizes last - 8 bits into the strip
words, 13 bits into the lamp's LEDC. The DDP path never enters the engine, so the host's gamma
cannot be applied twice. Standalone rendering is also the one place the frame's warm-white
emitters light: shows keep them dark by design (see the bench notes below), but a light asked
for a desaturated colour uses all four.

Settings are a versioned 12-byte blob (`light/src/settings.rs`) in the last 16 KB of the
Pico's flash (`node/src/persist.rs`, carved in `memory.x`) and in the `nvs` partition espflash
already writes on the C3 (`lamp/src/persist.rs`). Saves are debounced 2 s, immediate on off;
sequential-storage wear-levels, so even pathological use takes years to matter.

## The HTTP API

Port 80, JSON, one connection at a time, every response `Connection: close`. The same four
routes on both boards:

```sh
curl http://room-frame/api/state
# {"power":"on","colour":"#ffb46e","brightness":160,"effect":"twinkle","powerOn":"restore","mode":"smart"}

curl -X POST http://room-frame/api/state \
  -H 'content-type: application/json' -d '{"colour":"#3366ff","brightness":120,"effect":"fire"}'
# any subset of: power on|off, colour #rrggbb, brightness 0..255, effect, powerOn restore|always-on
# answers with the state that resulted; invalid values are 400 {"error":"brightness 0..255"}

curl -X POST http://room-frame/api/identify -H 'content-length: 0'
# two white pulses, for telling boards apart; 204

curl http://room-frame/api/info
# the hello line as JSON, plus the board's own address and the effects this build runs
```

`mode` reads `smart`, `party` or `party-muted` and is the one read-only field. Unknown JSON
fields are ignored, so an older phone shortcut keeps working against a newer build. iOS
Shortcuts or anything that can POST is already a remote.

Every response carries `Access-Control-Allow-Origin: *`, and `OPTIONS` on any path answers 204.
The controller (`apps/controller`) is served from somewhere else on the network, so every request
it makes is cross-origin; without those headers a browser may send to a board and never read the
reply, which is what limited the first controller page to displaying its own guesses. Nothing on
these boards is worth protecting from a device that is already on the WLAN, and the alternative
is a light that cannot be driven from a phone at all.

`info.ip` is the address DHCP landed on, read once when the HTTP task starts. It is redundant to
whoever already routed a request there, and it is the one thing a browser cannot work out for
itself: a page opened at a name has no way to learn its own subnet, and that subnet is what the
controller sweeps to find the rest of the lights.

Two listeners serve the API rather than one. The controller polls while it sends, and a board
with a single socket drops the SYN of whichever arrives second.

The implementation is `firmware/api`, which speaks only `embedded-io-async` and therefore
serves both boards from one host-tested crate.

## The controller

`apps/controller` is the phone side of that API: power, brightness, colour, effect, power-on
policy and identify, and nothing invented on top of them. Svelte and TypeScript, no dependencies
of its own, no backend - `npm run build -w @mv/controller` produces a `dist/` of five static
files that any web server on the network can hold. It is meant to live on the Pi.

```sh
npm run build -w @mv/controller
rsync -a apps/controller/dist/ pi@raspberrypi:/var/www/lights/
```

**Serve it over plain HTTP.** A page served over HTTPS cannot fetch `http://192.168.0.106` -
browsers block that as mixed content - so a TLS controller cannot reach a board at all. The cost
is that it is not a secure context and so has no service worker: iOS "Add to Home Screen" gives
the standalone window and the icon, Chrome will not offer an install prompt.

It finds the boards itself. The trick is that `location.hostname` is the address the page was
served from, so the subnet is known; from there it knocks on all 254 addresses in parallel and
keeps whatever answers `/api/info` with a name and a DDP port. Known hostnames and previously
seen addresses are tried first, so the usual case resolves in well under a second and the sweep
only runs to find siblings. **Open it at an address rather than a name** - `http://192.168.0.50/`
rather than `http://raspberrypi.local/` - or the first scan has no subnet to work from and falls
back to the known hostnames alone. After one light has been found the address is remembered and
either form works.

Two things follow from reading `/api/info` rather than assuming: the effect picker shows what the
fixture actually runs, so the lamp offers only `wash` and does not ask for effects it would
reject; and `mode` is surfaced, so a light being driven by a show says so instead of appearing to
ignore you.

The old `firmware/controller/frame-control.html` was a one-way prototype and is gone.

## Layout

```
wire/   the protocol: DDP parse, framebuffer, hello, stats. No Embassy, tests on the host.
light/  the light: engine, effects, colour maths, settings codec, API types. Same deal.
api/    the HTTP face: four routes over embedded-io-async. Same deal.
node/   the Pico W firmware: frame (default) and bench, cfg-selected in fixture/mod.rs.
lamp/   the C3 firmware. Its OWN cargo workspace: another architecture, another lock.
```

Everything platform-free is host-testable, which is most of 0.2's behaviour - the state table,
the fades, the blob, the HTTP routes are all pinned by `cargo test`. What remains on the boards
is bring-up, DMA and one loop per binary: a datagram against the API channel against the 1 Hz
stats report against the engine tick. The HTTP task never touches the fixture; it sends a
command through a channel and is answered with the state that resulted, so the loop stays the
single owner.

`Fixture::claim` takes the whole `Peripherals` by value, keeps what its build needs and hands
back the rest, which keeps the pin budget a compile error. On the Pico, cyw43 holds PIO0 SM0,
DMA_CH0 and GPIO 23/24/25/29; the settings flash takes DMA_CH1; the strips take PIO1 SM0-2 and
DMA_CH2-4.

## Setup

Once, on the machine that builds:

```sh
brew install picotool           # Pico: flashes the ELF over BOOTSEL USB
cargo install espflash --locked # C3: flashes and monitors over USB-C
```

`firmware/rust-toolchain.toml` pins the channel and both targets. Credentials are compiled in,
so export them first:

```sh
export WIFI_SSID='your-network'
export WIFI_PASSWORD='your-password'
```

## Build, flash, watch

The Pico, from `firmware/node`:

```sh
cargo build --release                                         # The Frame
cargo build --release --no-default-features --features bench  # the bench run

# hold BOOTSEL while plugging the board in, then
cargo run --release

screen /dev/tty.usbmodem* 115200
```

**Both write to the same path.** `target/thumbv6m-none-eabi/release/room-node` is whichever
build ran last, and flashing the wrong one costs an evening because the symptom is a strip that
does nothing on a board that is working perfectly. Check before flashing:

```sh
strings target/thumbv6m-none-eabi/release/room-node | grep -E 'room-(frame|bench)'
```

The lamp, from `firmware/lamp` - espflash writes bootloader, partition table and app, and stays
attached as the console:

```sh
cargo run --release
```

The host-side tests, from `firmware/`:

```sh
cargo test -p room-wire -p room-light -p room-api --target "$(rustc -vV | sed -n 's/^host: //p')"
```

The target is spelled out because `.cargo/config.toml` points the default at the Pico. Those
tests carry the wire contract: `hello.rs` and `stats.rs` emit strings that
`apps/web/src/lib/hardware.ts` parses, and both sides are pinned to the same text.

The banner gives you the address, and the board panel in the app (top right) takes it:

```
room-frame on 192.168.1.57, DDP :4048, stats -> :4049, http :80
```

A DHCP reservation is worth setting up; the hostnames offered are `room-frame`, `room-bench`
and `room-bounce`. The controller does not need one - it scans - but the board panel in
`apps/web` is still told an address by hand.

## What the host sends

Party mode receives gamma-corrected bytes and puts them out untouched. **Nothing rescales
anything on the board, and nothing should**: the mixer auto-exposes at track scale, holds a
house floor and compresses its own highlights, so what arrives is already the level the room is
meant to sit at. How bright the room is lives in three constants in
`packages/core/src/output.ts` (`MASTER`, `GAMMA` at 2.45, the `knee`), and the standalone
engine decodes through the same 2.45 so a wash and a show agree about what a colour means.

The lamp's one party pixel is derived host-side in `packages/core/src/bounce.ts`, where the
show's own `kickEnv` is visible; the board only puts it on four gates. The reduction used to
run on the board and moved out for good reason: a percentile over the room barely moves per
beat, and the host knows the beat exactly.

## The Frame, on three lines

720 addresses of four bytes on one Pico. The split is the reels: **A is Frame N + E, B is
S + W, C is the beam**, 300 / 300 / 120, contiguous in the host's buffer so the host sends one
stream and `present` slices it.

Three lines is what makes 60 fps possible: an address is 40 us, so 720 in a row would be
28.8 ms and cap the room near 34 fps. Written together with `join3`, three lines cost the
longest of them, 12.0 ms. cyw43 holds PIO0 SM0 and DMA_CH0, so the lines take PIO1 SM0/SM1/SM2
and DMA_CH2/CH3/CH4 on GP2, GP3 and GP4; the PIO program is loaded once and shared, so a fourth
line (the frame-brain board has the buffer and terminal for it on GP5) costs a state machine
and a DMA channel only.

The boot look is the engine's fade into the remembered state, and it doubles as the wiring
check: a line that never lights is a line that is not connected. The strip's measured facts -
byte order `SLOTS`, white trim, latch time - live in `fixture/rgbww.rs`; `bench` measures them
and `frame` inherits them.

## The bench run

5 m of SK6812 RGBWW on GP2, on a table, before there is a frame to hang it on. A real fixture
that joins, serves the API and runs shows; what makes it its own build is that a reel does not
come labelled, and its selftest reads three things off the strip by eye before anything above
them means anything:

- **Which wire byte reaches which emitter.** Byte 0, 1, 2, 3 alone, 1.5 s each, whole run.
  Write the colours down in that order; `SLOTS` in `fixture/rgbww.rs` is where the answer
  lives. Measured 2026-08-31: GRBW.
- **How many LEDs share one address.** The ruler frame: one mark in five lit, bright every
  twenty. One bright mark to the metre is 100 addresses, three is 300. This reel: 300, one IC
  per LED. `ADDRESSES` ships at 300 because over-counting only costs wire time where
  under-counting rejects every region the app can point at.
- **How much brighter the white emitter is.** The last two steps: R+G+B, then white alone, same
  duty, adjacent so the eye can compare. Set `TRIM[3]` near the ratio and **err low** - too much
  white destroys every pastel, and that failure reads as the palette being wrong rather than
  the fixture. This reel's white is dimmer than its three colour dies together, so the shipped
  quarter is conservative.

**The white emitter stays dark during a show.** The host sends RGB24 and `rgbww::unpack` puts
nothing on the fourth emitter: deriving white from the achromatic part was tried and washes the
room out, because the mixer already leaves most pixels part-desaturated. The palette was
designed against three dies. Standalone mode is different - the engine derives white on
purpose there, additively, and the same `TRIM[3]` keeps it honest.

A colour-shifted tail is never a data problem: the ICs keep clocking well below the voltage at
which the dies fall out of regulation, so a far end gone off-colour is starved, and the answer
is a second injection point, not a level shifter. Two families this build will not drive:
TM1814 (inverted waveform, runs a test pattern when data stops) and UCS8904B (16-bit).

## The Bounce Lamp

An RGB lamp taken apart for its strip and its driver board - a generic `UL NR:E330731` analog
RGBW controller: common anode at whatever the supply is, four low-side MOSFET gates, and an
unmarked
SOIC-8 doing the PWM. The brain is gone (its eight legs snipped) and an ESP32-C3-Zero drives
the four gate stubs directly. The board's own regulator is a 3.3 V `7533-1`, so the gates have
been driven at 3.3 V their whole life and the C3's pins are an exact replacement - no level
shifter, unlike the SK6812 lines.

```
  GPIO3 -> R gate stub      the four pads the SOIC-8 used to drive; a wrong order
  GPIO4 -> G gate stub      is a moved wire, shown by the boot selftest
  GPIO5 -> B gate stub
  GPIO6 -> W gate stub
  GND   -> GND-             the only wire that is not a gate

  supply -> 10V+ and GND-     the board passes its input straight through
  strip  -> the 5-pin header   to the strip, unchanged
```

**The board's two labels disagree with each other.** Its input terminal is silkscreened `10V+`
and its strip terminal `12V+`, and measured 2026-09-06 both sit at **10.33 V**. Since the board
is a pass-through, at most one of those labels can be describing the strip, so neither is worth
believing on its own. An earlier revision of this document read the input label, decided it was
wrong, and told you to feed 12 V; that was a guess dressed as an instruction.

The only label attached to the actual load is the one printed on the strip itself, and that is
what settles it. If the FPC says 12 V the lamp has been running underdriven and the supply is
the odd one out. If it says 10 V, do not raise it: an analog strip sets its channel current with
a resistor in series with three LEDs, the LEDs hold their forward drop regardless, and so nearly
all of an extra volt and a half lands on the resistor. That is a current increase far larger
than the voltage increase, and the strip will not complain until it has been on for weeks.

Until the strip has been read, leave the supply alone. It has run at 10.33 V its whole life.

GPIO3-6 keep clear of the C3's strapping pins (2, 8, 9). Ground is the only thing the two
boards share, and the strip's current never touches that jumper - it carries the microamps of
four gates and is also the C3's entire voltage reference, so make it solid. The C3 runs off
USB-C; a 12 V to 5 V buck into 5V is the one-cable version once the console stops being worth
a lead, and it has to be a switcher: the board's own 3.3 V rail is a 100 mA `7533-1` sized for
the SOIC-8 it fed, and a linear part dropping 10.3 V to 5 V burns half a watt to run a radio
that peaks at 350 mA. Check for a pull-down from each gate to ground and fit 10k where there is
none, or the
day a wire falls off is the day the lamp decides for itself.

**On every boot it plays R, G, B, then R+G+B, then W**, half a second each, before the radio
comes up. The first three answer the question the firmware cannot - which gate is which - and
the last two are the white-trim measurement at raw duty, so a wrong trim cannot hide a wiring
fault. White is added, not subtracted (a warm phosphor shares no white point with the RGB mix,
and adding cannot shift a hue), and `TRIM[3]` in `lamp/src/fixture.rs` ships at a quarter
because the phosphor pair outruns the colour dies several times over. Full white is also the
strip's peak draw, so that is the channel to pull down if the supply is short.

LEDC gives the lamp 13-bit duty at about 1.9 kHz - above flicker, far from the frame rate, and
32 times finer than the strip's own drivers, which is what keeps the always-visible power-on
fade smooth. If low duties read non-linear, lower the frequency rather than `TRIM`; the RC slew
limiter on each gate is the suspect.

## Answering "are you there"

The stats stream only goes to whoever is already sending DDP, so the board also answers a
query, on the DDP port, at any time:

```
-> ?room-node
<- room-node host room-frame fw 0.2.0 up 42s px 720 ddp 4048 stats 4049 leds sk6812 http 80
```

The reply goes to the asker's own source port. A leading `?` is `0x3f` and DDP v1 puts `0b01`
in its first byte's top bits, so the two parsers can never both claim a datagram. `leds` lists
one kind per output; `parseIdentity` reads tokens independently and ignores what it does not
know, which is how `http` joined the line without breaking anything.

## Reading the stats line

One line a second on the console, and the same line as a UDP datagram to port 4049 on whichever
host last sent DDP (`nc -lu 4049` for a board already on a wall):

```
up 42s  720 px  120 pkt/s  127.7 KB/s  60.0 fps  gap 15.9/17.8 ms  late 0/0/0  asm 2.1 ms  led 210 us  seqgap 0  bad 0  oob 0  torn 0
```

`fps` is the headline number and 60.0 is the target. `late` buckets frames arriving more than
20 / 50 / 100 ms after the one before; `led` is the only part of the frame the board spends
itself (the three DMA writes, ~12.3 ms on the frame); `torn` is trustworthy however the fixture
is split, where `seqgap` only means loss while this board is the sole DDP target. `oob` means
the host drives more pixels than this build holds - point the app at a single run on the bench
build, not `all`.

A reappearing banner means the Pico panicked and rebooted; it uses `panic-reset` deliberately,
because a silent halt would look exactly like a WiFi drop. The lamp prints a backtrace instead
and halts - it has a real console on USB-C, and `esp-backtrace` is the debugging story there.

## What it measured

Run on real hardware, 2026-08-07, a Pico W on 2.4 GHz against a MacBook sender. Reception is
not a problem: zero loss at 180 packets a second, sustained. Delivery timing is the problem and
it is the radio: about one stall per second over 100 ms, worst observed 316 ms, where loopback
never once exceeded 100 ms. `PowerManagementMode::None` versus `PowerSave` is a measured no-op
with cyw43 0.7.0. And pace the sender: a deadline pacer delivers 60.0 fps where
`setInterval(1000/60)` gives 57.8 to 58.7. `firmware/tools/ddp-probe.ts` reproduces all of
this against the real `createDdpSink`; interleave variants rather than batching them, because
2.4 GHz drifts enough over minutes to invent differences.

## What is left

**A jitter buffer, if the room is to stay on WiFi.** Present frames on the board's own 60 Hz
clock out of a small FIFO instead of on packet arrival. ~6 frames covers the measured p98
stall, 10 leaves headroom; the rare 316 ms outlier still glitches through. The show is
deterministic and the host can render ahead and cancel the lag with `offsetMs`. Get two things
right: occupancy has to steer the present period slowly (the two clocks drift), and a seek or
pause has to flush.

**The Frame has not been run against three strips at once.** `bench` measured one reel; the
three-line timing is arithmetic until `led` on the stats line confirms it.

**Reconnect on the Pico.** The lamp reconnects for life (its join is a task); the Pico still
joins once at boot and that is all. Note `is_link_up()` always returns true after the first
connect (embassy #4612), so it cannot be the trigger.

**Effects are tuned by eye, not yet judged.** Fire's spark rate and cooling shipped at
plausible constants; the room outranks the suite, so expect to touch
`light/src/effects/fire.rs` after an evening with it.

**A watchdog**, so a wedged radio recovers without someone walking to the board. **Static IP**
as an alternative to DHCP reservations. **A page at `/`** - the API was shaped so one can sit
beside it. **Apple Home / Google Home**, researched and parked: rs-matter-embassy runs working
Matter lights on both of these exact boards, Apple needs a home hub, Google a free dev-console
project; the engine's Command/StateDto seam is where a Matter task would attach without
touching the loop.
