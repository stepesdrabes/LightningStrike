//! What the strip is, as opposed to what a fixture does with it. `bench` measures these off a
//! reel; `frame` inherits them.

use smart_leds::{RGBW, White};

/// Wire byte each emitter arrives on: red, green, blue, white. Measured, not from a datasheet.
pub const SLOTS: [usize; 4] = [1, 0, 2, 3];

/// Per-channel scale, 256 unity, applied last so it can only pull a channel down.
pub const TRIM: [u32; 4] = [256, 256, 256, 64];

/// On top of the 55 us embassy waits, which satisfies the original WS2812B datasheet and nothing
/// since. Below the latch, back-to-back frames merge and colour walks down the strip.
pub const LATCH_TOP_UP_US: u64 = 225;

pub const BLACK: RGBW<u8> = RGBW { r: 0, g: 0, b: 0, a: White(0) };

/// Four bytes in the order the strip clocks them; the driver's `Rgbw` packing is the identity.
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

/// An RGB24 stream into strip words, zeroing whatever the frame did not cover. The white emitter
/// stays dark: deriving it from the achromatic part was tried and washes the room out, because
/// the mixer already leaves most pixels part-desaturated. To put it back, pass
/// `c[0].min(c[1]).min(c[2])` as the fourth emitter and raise `TRIM[3]`.
pub fn unpack(bytes: &[u8], out: &mut [RGBW<u8>]) {
	for (i, px) in out.iter_mut().enumerate() {
		*px = match bytes.get(i * 3..i * 3 + 3) {
			Some(c) => pack([c[0], c[1], c[2], 0]),
			None => BLACK,
		};
	}
}

/// The same, for a run laid against the buffer's direction: the host's last pixel is physical 0.
pub fn unpack_rev(bytes: &[u8], out: &mut [RGBW<u8>]) {
	let last = out.len() - 1;
	for (i, px) in out.iter_mut().enumerate() {
		let j = last - i;
		*px = match bytes.get(j * 3..j * 3 + 3) {
			Some(c) => pack([c[0], c[1], c[2], 0]),
			None => BLACK,
		};
	}
}

/// Linear RGBW emitters out of `room-light` into strip words; the strip is 8-bit, so the low
/// byte is dropped here and nowhere else.
pub fn pack16(emitters: [u16; 4]) -> RGBW<u8> {
	pack(emitters.map(|e| (e >> 8) as u8))
}
