use crate::effects::{scale, scatter, smooth_wave};

/// Three flicker periods with no common factor, in frames, so the sum never repeats soon.
const PERIODS: [u32; 3] = [23, 37, 61];
/// The flame's steady level and how far the flicker may pull it down, 16.16.
const STEADY: u32 = 52000;
const FLICKER: u32 = 18000;
/// How much of the light the warm-white emitter carries beyond the tint's own white.
const WARMTH: u32 = 24000;
/// Frames each pixel takes to slide from one grain level to the next.
const GRAIN_FRAMES: u32 = 24;

/// Candlelight: the tint at a slow, uneven flicker with the warm-white emitter glowing
/// underneath. Every pixel shares the flame; a little grain keeps the wall from reading flat.
pub fn render(out: &mut [[u16; 4]], t: u32, tint: [u16; 4], env: u32) {
	let peak = tint[0].max(tint[1]).max(tint[2]) as u64;
	// The flame: the mean of three eased waves, each on its own period.
	let mut flame = 0u64;
	for (k, period) in PERIODS.iter().enumerate() {
		flame += smooth_wave(t + k as u32 * 7, *period) as u64;
	}
	let flame = (flame / 3) as u32;
	let level = STEADY - FLICKER + (((FLICKER as u64) * flame as u64) >> 16) as u32;
	let epoch = t / GRAIN_FRAMES;
	let between = (t % GRAIN_FRAMES) as u64 * 65536 / GRAIN_FRAMES as u64;
	for (i, px) in out.iter_mut().enumerate() {
		// Grain that drifts: each pixel slides between two hashed levels, so the same pixel is
		// not always the dim one and no frame steps.
		let grain = |e: u32| 60000 + (scatter(i as u32 ^ e.wrapping_mul(0x9e37_79b9)) >> 16) % 5536;
		let (g0, g1) = (grain(epoch) as u64, grain(epoch + 1) as u64);
		let grain = (g0 * (65536 - between) + g1 * between) >> 16;
		let lit = ((level as u64 * grain) >> 16) as u32;
		let q = ((lit as u64 * env as u64) >> 16) as u32;
		*px = scale(tint, q);
		let warm = ((peak * WARMTH as u64 >> 16) * q as u64) >> 16;
		px[3] = px[3].max(warm as u16);
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn flickers_gently_and_warms_with_the_white_emitter() {
		let mut out = [[0u16; 4]; 16];
		let tint = [65535, 45000, 20000, 0];
		let mut lo = u16::MAX;
		let mut hi = 0u16;
		let mut prev = 0u16;
		let mut max_step = 0u16;
		for t in 0..1200 {
			render(&mut out, t, tint, 65536);
			let v = out[0][0];
			lo = lo.min(v);
			hi = hi.max(v);
			if t > 0 {
				max_step = max_step.max(v.abs_diff(prev));
			}
			prev = v;
			assert!(out[0][3] > 10000, "the warm emitter carries the flame");
		}
		assert!(hi - lo > 8000, "it flickers: {lo}..{hi}");
		assert!(lo > 25000, "it never gutters out: {lo}");
		assert!(max_step < 3000, "the flicker is a movement, not a strobe: {max_step}");
		render(&mut out, 5, tint, 0);
		assert!(out.iter().all(|px| *px == [0; 4]));
	}
}
