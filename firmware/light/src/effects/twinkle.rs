use crate::effects::scatter;

/// Frames one point takes to rise and fall, and how bright it gets.
const PULSE: u32 = 96;
const PEAK: u32 = 70;

const HUES: [[u8; 3]; 6] =
	[[255, 55, 20], [255, 150, 30], [40, 255, 90], [30, 175, 255], [90, 80, 255], [220, 60, 200]];

/// Fixture-global pixel i, frame count t, gain 0..256. Linear RGBW output with white dark.
pub fn twinkle(i: u32, t: u32, gain: u32) -> [u16; 4] {
	let h = scatter(i);
	let period = PULSE * 5 + (h & 0x1ff);
	let pos = (t + (h >> 8) % period) % period;
	if pos < PULSE {
		let ramp = if pos * 2 <= PULSE { pos * 2 } else { 2 * (PULSE - pos) };
		let level = ramp * PEAK / PULSE * gain / 256;
		let hue = HUES[(h >> 24) as usize % HUES.len()];
		[dim(hue[0], level), dim(hue[1], level), dim(hue[2], level), 0]
	} else {
		[0; 4]
	}
}

/// Top byte exactly the 0.1 u8 maths (the boot look must not change), remainder in the low byte.
fn dim(c: u8, level: u32) -> u16 {
	let x = c as u32 * level;
	(((x / 255) << 8) | ((x % 255) * 257 / 255)) as u16
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn top_byte_matches_the_old_maths() {
		for i in [0u32, 1, 7, 299, 300, 599, 600, 719] {
			for t in [0u32, 1, 48, 96, 200, 5000] {
				for gain in [0u32, 64, 128, 256] {
					let h = scatter(i);
					let period = PULSE * 5 + (h & 0x1ff);
					let pos = (t + (h >> 8) % period) % period;
					let expect: [u8; 3] = if pos < PULSE {
						let ramp = if pos * 2 <= PULSE { pos * 2 } else { 2 * (PULSE - pos) };
						let level = ramp * PEAK / PULSE * gain / 256;
						let hue = HUES[(h >> 24) as usize % HUES.len()];
						[0, 1, 2].map(|k| (hue[k] as u32 * level / 255) as u8)
					} else {
						[0; 3]
					};
					let got = twinkle(i, t, gain);
					assert_eq!([got[0] >> 8, got[1] >> 8, got[2] >> 8], expect.map(u16::from));
					assert_eq!(got[3], 0);
				}
			}
		}
	}
}
