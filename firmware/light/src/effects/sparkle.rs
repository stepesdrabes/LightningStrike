use crate::effects::{scale, scatter, smooth_wave};

/// The bed under the glints, 16.16.
const BED: u32 = 20000;
/// Frames a glint takes to rise and fall, and the least frames between one pixel's glints.
const GLINT: u32 = 20;
const REST_MIN: u32 = 160;
/// One pixel in this many carries glints at all; the rest hold the bed.
const SPARSE: u32 = 3;

/// A dim field of the tint with brief white glints, each rising and falling rather than
/// snapping, on a rhythm no two neighbours share. The white emitter carries the glint.
pub fn render(out: &mut [[u16; 4]], t: u32, tint: [u16; 4], env: u32) {
	let peak = tint[0].max(tint[1]).max(tint[2]).max(tint[3]) as u64;
	let bed = scale(tint, ((BED as u64 * env as u64) >> 16) as u32);
	for (i, px) in out.iter_mut().enumerate() {
		let h = scatter(i as u32);
		*px = bed;
		if h % SPARSE != 0 {
			continue;
		}
		let period = REST_MIN + (h >> 8) % 200;
		let pos = (t + (h >> 16) % period) % period;
		if pos >= GLINT {
			continue;
		}
		let g = ((smooth_wave(pos, GLINT) as u64 * env as u64) >> 16) as u64;
		// The colour lifts halfway toward full; the white emitter does the glint.
		for k in 0..3 {
			let room = tint[k].saturating_sub(bed[k]) as u64;
			px[k] = px[k].saturating_add(((room * g / 2) >> 16) as u16);
		}
		px[3] = px[3].max(((peak * g) >> 16) as u16);
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn glints_are_sparse_white_and_eased() {
		let mut out = [[0u16; 4]; 300];
		let tint = [65535, 40000, 20000, 20000];
		let mut lit_frames = 0u32;
		let mut max_step = 0u16;
		let mut prev = [[0u16; 4]; 300];
		for t in 0..600 {
			render(&mut out, t, tint, 65536);
			let glinting = out.iter().filter(|px| px[3] > 30000).count();
			if glinting > 0 {
				lit_frames += 1;
			}
			assert!(glinting < 40, "a glint is an event, not a wash: {glinting}");
			if t > 0 {
				for (a, b) in out.iter().zip(prev.iter()) {
					max_step = max_step.max(a[3].abs_diff(b[3]));
				}
			}
			prev = out;
		}
		assert!(lit_frames > 100, "glints happen: {lit_frames}");
		assert!(max_step < 20000, "a glint rises over several frames: {max_step}");
		render(&mut out, 7, tint, 0);
		assert!(out.iter().all(|px| *px == [0; 4]));
	}
}
