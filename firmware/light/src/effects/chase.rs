use crate::effects::scale;

/// Frames for one lap of the fixture: twenty seconds at the frame's engine period.
const LAP: u32 = 800;
/// The tail, as a fraction of the fixture, 16.16.
const TAIL: u32 = 14000;
/// The bed the comet passes over, 16.16.
const BED: u32 = 9000;

/// One soft comet circling the room over a dim bed, its head brightened by the white emitter.
pub fn render(out: &mut [[u16; 4]], t: u32, tint: [u16; 4], env: u32) {
	let n = out.len() as u64;
	if n == 0 {
		return;
	}
	let peak = tint[0].max(tint[1]).max(tint[2]).max(tint[3]) as u64;
	// Head position in 16.16 of the ring, so the motion is sub-pixel smooth.
	let head = (t % LAP) as u64 * 65536 / LAP as u64;
	for (i, px) in out.iter_mut().enumerate() {
		let u = i as u64 * 65536 / n;
		// Distance behind the head, round the ring.
		let behind = (head + 65536 - u) % 65536;
		let body = if behind < TAIL as u64 {
			let q = (TAIL as u64 - behind) * 65536 / TAIL as u64;
			(q * q) >> 16
		} else {
			0
		};
		let lit = BED as u64 + ((65536 - BED as u64) * body >> 16);
		*px = scale(tint, ((lit * env as u64) >> 16) as u32);
		// The tip: the head pixel and the one behind it reach for white.
		if behind < 65536 * 2 / n {
			let tip = ((peak * 3 / 4) * env as u64) >> 16;
			px[3] = px[3].max(tip as u16);
		}
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	/// The first pixel carrying the tip; the tip is two pixels wide.
	fn head_index(out: &[[u16; 4]]) -> usize {
		let top = out.iter().map(|px| px[3]).max().unwrap();
		out.iter().position(|px| px[3] == top).unwrap()
	}

	#[test]
	fn the_comet_moves_forward_over_a_lit_bed() {
		let mut out = [[0u16; 4]; 200];
		let tint = [65535, 50000, 30000, 30000];
		render(&mut out, 0, tint, 65536);
		let bed = (65535u64 * BED as u64 >> 16) as u16;
		assert!(out.iter().all(|px| px[0] >= bed - 1), "the bed stays lit behind the tail");
		render(&mut out, LAP / 4, tint, 65536);
		let first = head_index(&out);
		render(&mut out, LAP / 2, tint, 65536);
		let later = head_index(&out);
		assert_eq!(later - first, 50, "a quarter lap in a quarter of the frames");
		assert!(out[later][3] > 40000, "the head reaches for white");
		render(&mut out, 3, tint, 0);
		assert!(out.iter().all(|px| *px == [0; 4]));
	}
}
