//! Standalone effects, one per file. Each yields linear RGBW emitter values; whatever measured
//! trims a fixture carries are applied downstream, so an effect never knows a strip's facts.

pub mod fire;
pub mod twinkle;
pub mod wash;

/// Knuth's multiplicative hash, enough to keep neighbours off the same rhythm.
pub(crate) fn scatter(i: u32) -> u32 {
	let h = i.wrapping_mul(2_654_435_761);
	h ^ (h >> 15)
}
