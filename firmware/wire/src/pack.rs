//! The packed DDP payload: one datagram a frame instead of two.
//!
//! 673 pixels of RGB24 are 2019 bytes, so every frame is split and the room only moves when
//! both halves land. Measured against real layer stacks (`bench/wireprobe.ts`), splitting the
//! buffer into colour planes, differencing each plane along the strip and coding the result in
//! nibbles leaves a mean of 784 bytes and puts 92% of frames in one datagram. It is lossless,
//! so a show renders byte for byte as before, and each datagram decodes from itself alone,
//! which is what keeps a lost packet from costing more than its own frame.
//!
//! Payload: a big-endian u16 of the decoded length, then nibbles, high nibble first.
//!
//! | nibble | meaning |
//! |---|---|
//! | 0..12 | the difference from the byte before, in [`SMALL`] order |
//! | 13 | a run of 3..18 equal bytes; the next nibble is the length less 3 |
//! | 14 | a run of 19..274 equal bytes; the next two nibbles are the length less 19 |
//! | 15 | the next two nibbles are the difference itself |

/// Differences the small codes carry, as they wrap: 0, +-1 .. +-6.
const SMALL: [u8; 13] = [0, 1, 255, 2, 254, 3, 253, 4, 252, 5, 251, 6, 250];

const RUN_SHORT: u8 = 13;
const RUN_LONG: u8 = 14;
const LITERAL: u8 = 15;

/// Shortest run worth a code of its own: two zeros already cost two nibbles as themselves.
const RUN_MIN: usize = 3;
const RUN_SHORT_MAX: usize = RUN_MIN + 15;

/// Header ahead of the nibbles.
const LENGTH_PREFIX: usize = 2;

/// Reads nibbles out of the payload, high one first.
struct Nibbles<'a> {
	src: &'a [u8],
	at: usize,
}

impl Nibbles<'_> {
	fn next(&mut self) -> Option<u8> {
		let byte = *self.src.get(self.at / 2)?;
		let value = if self.at % 2 == 0 { byte >> 4 } else { byte & 0x0f };
		self.at += 1;
		Some(value)
	}

	fn byte(&mut self) -> Option<u8> {
		Some((self.next()? << 4) | self.next()?)
	}
}

/// Writes plane-ordered bytes back into RGB24 without a second buffer.
struct Interleave<'a> {
	out: &'a mut [u8],
	pixels: usize,
	plane: usize,
	k: usize,
	at: usize,
}

impl Interleave<'_> {
	fn put(&mut self, value: u8) -> bool {
		if self.plane >= 3 {
			return false;
		}
		self.out[self.at] = value;
		self.k += 1;
		if self.k == self.pixels {
			self.plane += 1;
			self.k = 0;
			self.at = self.plane;
		} else {
			self.at += 3;
		}
		true
	}
}

/// Decodes into `out`, which must be whole pixels. None for a payload this build cannot trust:
/// a truncated stream, or a length that does not fit. Bytes past the declared length are
/// padding and are ignored.
///
/// A refusal can have written part of `out` already, because decoding is one pass with no
/// second buffer. The caller owns what that means for the frame it is holding.
pub fn unpack(src: &[u8], out: &mut [u8]) -> Option<usize> {
	let len = usize::from(u16::from_be_bytes([*src.first()?, *src.get(1)?]));
	if len > out.len() || len % 3 != 0 {
		return None;
	}

	let mut nibbles = Nibbles { src: &src[LENGTH_PREFIX..], at: 0 };
	let mut w = Interleave { out, pixels: len / 3, plane: 0, k: 0, at: 0 };
	let mut written = 0usize;
	let mut value = 0u8;

	while written < len {
		let code = nibbles.next()?;
		let (delta, count) = match code {
			RUN_SHORT => (0u8, usize::from(nibbles.next()?) + RUN_MIN),
			RUN_LONG => (0u8, usize::from(nibbles.byte()?) + RUN_SHORT_MAX + 1),
			LITERAL => (nibbles.byte()?, 1),
			c => (*SMALL.get(usize::from(c))?, 1),
		};

		if written + count > len {
			return None;
		}
		value = value.wrapping_add(delta);
		for _ in 0..count {
			if !w.put(value) {
				return None;
			}
		}
		written += count;
	}
	Some(len)
}

#[cfg(test)]
mod tests {
	use super::*;
	extern crate std;
	use std::vec::Vec;

	/// The encoder's ceiling for one run code; the decoder reaches it through RUN_SHORT_MAX.
	const RUN_LONG_MAX: usize = RUN_SHORT_MAX + 1 + 255;

	/// A second encoder, for round trips over shapes no fixture would send. What the host
	/// actually emits is pinned by pack-vectors.txt, which this one cannot drift away from.
	fn pack(rgb: &[u8]) -> Vec<u8> {
		let pixels = rgb.len() / 3;
		let mut planed = Vec::new();
		for c in 0..3 {
			for k in 0..pixels {
				planed.push(rgb[k * 3 + c]);
			}
		}

		let mut nibbles: Vec<u8> = Vec::new();
		let mut previous = 0u8;
		let mut i = 0;
		while i < planed.len() {
			let delta = planed[i].wrapping_sub(previous);
			previous = planed[i];
			match SMALL.iter().position(|&d| d == delta) {
				Some(code) => nibbles.push(code as u8),
				None => {
					nibbles.push(LITERAL);
					nibbles.push(delta >> 4);
					nibbles.push(delta & 0x0f);
				}
			}
			i += 1;

			// A run code carries the repeats after that byte, which is why they are zero runs.
			let mut repeats = 0;
			while repeats < RUN_LONG_MAX
				&& i + repeats < planed.len()
				&& planed[i + repeats] == previous
			{
				repeats += 1;
			}
			if repeats < RUN_MIN {
				continue;
			}
			if repeats <= RUN_SHORT_MAX {
				nibbles.push(RUN_SHORT);
				nibbles.push((repeats - RUN_MIN) as u8);
			} else {
				let n = repeats - RUN_SHORT_MAX - 1;
				nibbles.push(RUN_LONG);
				nibbles.push((n >> 4) as u8);
				nibbles.push((n & 0x0f) as u8);
			}
			i += repeats;
		}

		let mut out = Vec::new();
		out.extend_from_slice(&(rgb.len() as u16).to_be_bytes());
		for pair in nibbles.chunks(2) {
			out.push((pair[0] << 4) | pair.get(1).copied().unwrap_or(0));
		}
		out
	}

	fn round_trip(rgb: &[u8]) -> Vec<u8> {
		let packed = pack(rgb);
		let mut out = std::vec![0u8; rgb.len()];
		assert_eq!(unpack(&packed, &mut out), Some(rgb.len()));
		out
	}

	#[test]
	fn returns_what_went_in() {
		let flat: Vec<u8> = std::vec![17; 300];
		assert_eq!(round_trip(&flat), flat);

		let ramp: Vec<u8> = (0..300u32).map(|i| (i % 251) as u8).collect();
		assert_eq!(round_trip(&ramp), ramp);

		// A lit pixel in the dark, which is what a run code has to survive.
		let mut sparkle = std::vec![0u8; 3 * 200];
		sparkle[3 * 137] = 255;
		sparkle[3 * 137 + 1] = 90;
		assert_eq!(round_trip(&sparkle), sparkle);
	}

	#[test]
	fn survives_a_run_longer_than_one_code_carries() {
		let dark = std::vec![0u8; 3 * 673];
		assert_eq!(round_trip(&dark), dark);
	}

	#[test]
	fn a_frame_of_show_bytes_fits_one_datagram() {
		// A gradient across the runs with a moving accent, the shape real show frames take.
		let mut rgb = std::vec![0u8; 3 * 673];
		for k in 0..673 {
			rgb[k * 3] = (k / 3) as u8;
			rgb[k * 3 + 1] = (k / 8) as u8;
			rgb[k * 3 + 2] = if k % 97 == 0 { 200 } else { 4 };
		}
		let packed = pack(&rgb);
		assert!(packed.len() < 1440, "packed to {} bytes", packed.len());
		assert_eq!(round_trip(&rgb), rgb);
	}

	fn bytes(hex: &str) -> Vec<u8> {
		(0..hex.len() / 2)
			.map(|i| u8::from_str_radix(&hex[i * 2..i * 2 + 2], 16).unwrap())
			.collect()
	}

	/// Every case the host encoder emits, decoded by the decoder that ships. This is the one
	/// test that fails if the two sides of the wire stop agreeing.
	#[test]
	fn decodes_what_the_host_encoder_emits() {
		let mut cases = 0;
		for line in include_str!("pack-vectors.txt").lines() {
			if line.starts_with('#') || line.is_empty() {
				continue;
			}
			let mut parts = line.split(" | ");
			let why = parts.next().unwrap();
			let rgb = bytes(parts.next().unwrap());
			let packed = bytes(parts.next().unwrap());

			let mut out = std::vec![0xaau8; rgb.len().max(1)];
			assert_eq!(unpack(&packed, &mut out), Some(rgb.len()), "{why}");
			assert_eq!(&out[..rgb.len()], &rgb[..], "{why}");
			cases += 1;
		}
		assert!(cases >= 30, "the vector file lost its cases");
	}

	#[test]
	fn refuses_a_payload_it_cannot_trust() {
		let mut out = [0u8; 12];
		// Declares more than the caller's buffer holds.
		assert_eq!(unpack(&[0xff, 0xff, 0x00], &mut out), None);
		// Declares part of a pixel.
		assert_eq!(unpack(&[0x00, 0x04, 0x00], &mut out), None);
		// Runs out of nibbles before the declared length.
		assert_eq!(unpack(&[0x00, 0x0c, 0x00], &mut out), None);
		// No header at all.
		assert_eq!(unpack(&[], &mut out), None);
		assert_eq!(unpack(&[0x00], &mut out), None);
	}
}
