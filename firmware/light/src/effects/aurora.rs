use crate::effects::{companion, scale, smooth_wave};

/// Frames for the two curtains to go once round, in opposite directions.
const LAP_A: u32 = 1400;
const LAP_B: u32 = 2200;
/// A curtain spans this much of the fixture, 16.16.
const WIDTH: u32 = 24000;
/// The dim wash under the curtains, 16.16, so the room stays lit between them.
const FLOOR: u32 = 12000;

/// Two soft curtains in the tint and its companion hue, drifting round the room past each
/// other. Nothing here happens faster than the slower of the two laps.
pub fn render(out: &mut [[u16; 4]], t: u32, tint: [u16; 4], env: u32) {
	let n = out.len() as u64;
	if n == 0 {
		return;
	}
	let other = companion(tint);
	let a_at = ((t % LAP_A) as u64 * 65536 / LAP_A as u64) as u32;
	let b_at = 65536 - ((t % LAP_B) as u64 * 65536 / LAP_B as u64) as u32;
	for (i, px) in out.iter_mut().enumerate() {
		let u = (i as u64 * 65536 / n) as u32;
		let a = curtain(u, a_at);
		let b = curtain(u, b_at);
		// Whichever curtain is stronger lends its hue; between them the floor keeps the tint.
		let lit = FLOOR + (((65536 - FLOOR) as u64 * a.max(b) as u64) >> 16) as u32;
		let mix = if a + b == 0 { 0 } else { (b as u64 * 65536 / (a + b) as u64) as u32 };
		let colour = blend(tint, other, mix);
		*px = scale(colour, ((lit as u64 * env as u64) >> 16) as u32);
	}
}

/// Eased bump of `WIDTH` around `centre`, on a ring.
fn curtain(u: u32, centre: u32) -> u32 {
	let d = u.abs_diff(centre);
	let d = d.min(65536 - d);
	if d >= WIDTH / 2 {
		0
	} else {
		smooth_wave(WIDTH / 2 - d, WIDTH)
	}
}

fn blend(a: [u16; 4], b: [u16; 4], q: u32) -> [u16; 4] {
	let mut out = [0u16; 4];
	for k in 0..4 {
		let d = b[k] as i64 - a[k] as i64;
		out[k] = (a[k] as i64 + ((d * q as i64) >> 16)) as u16;
	}
	out
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn lights_the_whole_ring_and_moves_slowly() {
		let mut out = [[0u16; 4]; 120];
		let tint = [65535, 30000, 10000, 10000];
		render(&mut out, 100, tint, 65536);
		// The companion hue moves light between dies without losing it: judge the sum.
		let floor = (105535u64 * FLOOR as u64 >> 16) as u32;
		let lit = |px: &[u16; 4]| px[0] as u32 + px[1] as u32 + px[2] as u32;
		assert!(out.iter().all(|px| lit(px) >= floor - 3), "no dark holes between curtains");
		let brightest = out.iter().map(|px| px[0]).max().unwrap();
		assert!(brightest > 60000, "a curtain reaches the tint");

		let mut later = [[0u16; 4]; 120];
		render(&mut later, 101, tint, 65536);
		let moved: u32 =
			out.iter().zip(later.iter()).map(|(a, b)| a[0].abs_diff(b[0]) as u32).sum();
		assert!(moved < 120 * 800, "one frame is a small move, not a step: {moved}");

		render(&mut out, 100, tint, 0);
		assert!(out.iter().all(|px| *px == [0; 4]));
	}
}
