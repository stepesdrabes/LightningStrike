use crate::effects::{scale, smooth_wave};

/// Frames per breath in and out: six seconds at the frame's engine period.
const PERIOD: u32 = 240;
/// The trough, 16.16: the room dims between breaths without going out.
const TROUGH: u32 = 22000;

/// The whole fixture swelling and settling on one slow breath, warm white and all.
pub fn render(out: &mut [[u16; 4]], t: u32, tint: [u16; 4], env: u32) {
	let level = TROUGH + (((65536 - TROUGH) as u64 * smooth_wave(t, PERIOD) as u64) >> 16) as u32;
	let q = ((level as u64 * env as u64) >> 16) as u32;
	out.fill(scale(tint, q));
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn breathes_between_the_trough_and_full_and_never_out() {
		let mut out = [[0u16; 4]; 8];
		let tint = [65535, 40000, 20000, 30000];
		let mut lo = u16::MAX;
		let mut hi = 0u16;
		for t in 0..PERIOD * 2 {
			render(&mut out, t, tint, 65536);
			assert!(out.iter().all(|px| *px == out[0]), "one breath for the whole fixture");
			lo = lo.min(out[0][0]);
			hi = hi.max(out[0][0]);
		}
		assert!(lo > 20000 && lo < 24000, "trough {lo}");
		assert!(hi >= 65534, "peak {hi}");
		render(&mut out, PERIOD / 2, tint, 65536);
		assert!(out[0][3] > 29000, "the white emitter breathes with the colour");
		render(&mut out, PERIOD / 2, tint, 0);
		assert_eq!(out[0], [0; 4]);
	}
}
