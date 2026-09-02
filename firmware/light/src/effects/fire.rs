use crate::effects::scatter;

/// Sparks per 1024 pixels per tick; with the 0..7 cooling this settles near an ember to every
/// ten pixels, glow between them carried by the diffusion.
const SPARK_PER_1024: u32 = 2;

/// Heat white-hot enough to reach the white emitter directly.
const WHITE_HOT: u32 = 235;

/// An ember field along the run: heat decays, neighbours share it, sparks reignite it. The tint
/// is the flame body, so the default amber reads as fire and any other colour is that colour
/// burning. On one pixel the diffusion is a no-op and what remains is a candle.
pub fn render(out: &mut [[u16; 4]], heat: &mut [u8], t: u32, tint: [u16; 4], env: u32) {
	let n = out.len().min(heat.len());
	if n == 0 {
		return;
	}

	for (i, h) in heat.iter_mut().enumerate().take(n) {
		let r = scatter(i as u32 ^ t.wrapping_mul(0x9e37_79b9));
		*h = h.saturating_sub((r & 0x7) as u8);
		if (r >> 16) & 0x3ff < SPARK_PER_1024 {
			*h = 190 + ((r >> 26) & 0x3f) as u8;
		}
	}

	let first = heat[0];
	let mut prev = heat[n - 1];
	for i in 0..n {
		let next = if i + 1 < n { heat[i + 1] } else { first };
		let cur = heat[i];
		heat[i] = ((prev as u32 + 2 * cur as u32 + next as u32) / 4) as u8;
		prev = cur;
	}

	let peak = tint[0].max(tint[1]).max(tint[2]) as u32;
	for i in 0..n {
		let h = heat[i] as u32;
		// Quadratic toe: embers glow rather than glare, and only the hottest reach for white.
		let q = (((h * h * 257) >> 8) * env) >> 16;
		let mut px = tint.map(|c| ((c as u32 * q) >> 16) as u16);
		if h > WHITE_HOT {
			let hot = (((h - WHITE_HOT) * 3277).min(65535) * peak) >> 16;
			px[3] = px[3].max(((hot * env) >> 16) as u16);
		}
		out[i] = px;
	}
}
