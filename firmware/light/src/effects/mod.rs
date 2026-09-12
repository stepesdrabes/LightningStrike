//! Linear RGBW effects, independent of fixture-specific trims applied downstream.

pub mod aurora;
pub mod breathe;
pub mod candle;
pub mod chase;
pub mod fire;
pub mod sparkle;
pub mod twinkle;
pub mod wash;

/// Knuth's multiplicative hash, enough to keep neighbours off the same rhythm.
pub(crate) fn scatter(i: u32) -> u32 {
	let h = i.wrapping_mul(2_654_435_761);
	h ^ (h >> 15)
}

/// A smoothed triangle over `period` frames: 0 at `pos` 0, 65536 halfway, back to 0. The
/// ease at both ends is what stops a slow fade reading as a ramp with corners.
pub(crate) fn smooth_wave(pos: u32, period: u32) -> u32 {
	let period = period.max(2);
	let pos = pos % period;
	let x = if pos * 2 <= period {
		pos as u64 * 2 * 65536 / period as u64
	} else {
		(period - pos) as u64 * 2 * 65536 / period as u64
	};
	// 3x^2 - 2x^3 in 16.16.
	((3 * x * x * 65536 - 2 * x * x * x) >> 32) as u32
}

/// Scale a linear RGBW value by `q` in 0..=65536.
pub(crate) fn scale(px: [u16; 4], q: u32) -> [u16; 4] {
	px.map(|c| ((c as u32 * q) >> 16) as u16)
}

/// The tint turned to a neighbouring hue, for effects that want two colours from one choice.
/// Rotating the dies moves the hue by a third of the wheel; halving the mix keeps it a
/// relation of the chosen colour rather than a stranger.
pub(crate) fn companion(tint: [u16; 4]) -> [u16; 4] {
	let turned = [tint[1], tint[2], tint[0], tint[3]];
	[
		((tint[0] as u32 + turned[0] as u32) / 2) as u16,
		((tint[1] as u32 + turned[1] as u32) / 2) as u16,
		((tint[2] as u32 + turned[2] as u32) / 2) as u16,
		tint[3] / 2,
	]
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn smooth_wave_is_bounded_symmetric_and_eased() {
		assert_eq!(smooth_wave(0, 100), 0);
		assert_eq!(smooth_wave(50, 100), 65536);
		assert_eq!(smooth_wave(25, 100), smooth_wave(75, 100));
		// Half the ramp is well under half the level: the ends are eased.
		assert!(smooth_wave(12, 100) < 16384);
		for p in 0..400 {
			assert!(smooth_wave(p, 100) <= 65536);
		}
	}

	#[test]
	fn companion_keeps_a_relation_to_the_tint() {
		assert_eq!(companion([65535, 0, 0, 0]), [32767, 0, 32767, 0]);
	}
}
