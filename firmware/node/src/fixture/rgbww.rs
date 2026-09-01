//! What the strip is, as opposed to what a fixture does with it. `bench` measures these off a
//! reel; `frame` inherits them.

use smart_leds::{RGBW, White};

/// Wire byte each emitter arrives on: red, green, blue, white. Measured, not from a datasheet.
pub const SLOTS: [usize; 4] = [1, 0, 2, 3];

/// Per-channel scale, 256 unity, applied last so it can only pull a channel down.
pub const TRIM: [u32; 4] = [256, 256, 256, 64];

/// On top of the 55 us embassy waits privately, which satisfies the original WS2812B datasheet and
/// nothing since. Below the latch, back-to-back frames merge and colour walks down the strip.
pub const LATCH_TOP_UP_US: u64 = 225;

pub const BLACK: RGBW<u8> = RGBW { r: 0, g: 0, b: 0, a: White(0) };

/// Four bytes in the order the strip clocks them. The driver's `Rgbw` packing is the identity, so
/// these fields are byte positions and [`SLOTS`] stays the only place the real order lives.
pub fn wire(bytes: [u8; 4]) -> RGBW<u8> {
	RGBW { r: bytes[0], g: bytes[1], b: bytes[2], a: White(bytes[3]) }
}

pub fn pack(emitters: [u8; 4]) -> RGBW<u8> {
	let mut bytes = [0u8; 4];
	for (i, &level) in emitters.iter().enumerate() {
		bytes[SLOTS[i]] = ((level as u32 * TRIM[i]) >> 8).min(255) as u8;
	}
	wire(bytes)
}

/// An RGB24 stream into strip words, zeroing whatever the frame did not cover.
///
/// **A show never lights the white emitter.** Deriving it as the achromatic part of each pixel is
/// the textbook thing to do and it was tried: it washes the room out, because the mixer already
/// leaves most pixels part-desaturated and adding a fourth emitter to those takes the colour the
/// rest of the way out. The palette was designed against three dies, so it gets three. To put it
/// back, pass `c[0].min(c[1]).min(c[2])` as the fourth emitter below and raise `TRIM[3]`.
pub fn unpack(bytes: &[u8], out: &mut [RGBW<u8>]) {
	for (i, px) in out.iter_mut().enumerate() {
		*px = match bytes.get(i * 3..i * 3 + 3) {
			Some(c) => pack([c[0], c[1], c[2], 0]),
			None => BLACK,
		};
	}
}

/// How long the twinkle takes to arrive, in idle frames. Around seven seconds.
pub const FADE: u32 = 200;

/// How long one point takes to rise and fall, and how bright it gets. An idle frame is about
/// 30 ms, so a point breathes over three seconds and repeats somewhere between 16 and 33.
const PULSE: u32 = 96;
const PEAK: u32 = 70;

const HUES: [[u8; 3]; 6] =
	[[255, 55, 20], [255, 150, 30], [40, 255, 90], [30, 175, 255], [90, 80, 255], [220, 60, 200]];

/// Scattered points rising and falling at their own rates, dim.
///
/// `t` counts idle frames and `gain` is 0..256, so the whole thing arrives rather than switching
/// on. `seed` is the buffer's offset into the fixture, without which every line would twinkle in
/// step with the others.
pub fn twinkle(buf: &mut [RGBW<u8>], t: u32, gain: u32, seed: u32) {
	for (i, px) in buf.iter_mut().enumerate() {
		let h = scatter(i as u32 + seed);
		let period = PULSE * 5 + (h & 0x1ff);
		let pos = (t + (h >> 8) % period) % period;
		*px = if pos < PULSE {
			let ramp = if pos * 2 <= PULSE { pos * 2 } else { 2 * (PULSE - pos) };
			let level = ramp * PEAK / PULSE * gain / 256;
			let hue = HUES[(h >> 24) as usize % HUES.len()];
			pack([dim(hue[0], level), dim(hue[1], level), dim(hue[2], level), 0])
		} else {
			BLACK
		};
	}
}

fn dim(c: u8, level: u32) -> u8 {
	(c as u32 * level / 255) as u8
}

/// Knuth's multiplicative hash, enough to keep neighbours off the same rhythm.
fn scatter(i: u32) -> u32 {
	let h = i.wrapping_mul(2_654_435_761);
	h ^ (h >> 15)
}
