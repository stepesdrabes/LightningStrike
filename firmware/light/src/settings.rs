//! The remembered light as a fixed 12-byte blob. Additions go into the reserved bytes without a
//! version bump; a relayout bumps it, and an unknown version reads as "use the defaults".

use crate::state::{Colour, EffectKind, LightState, PowerOnPolicy};

pub const BLOB_LEN: usize = 12;
const VERSION: u8 = 1;

const FLAG_ON: u8 = 1 << 0;
const FLAG_ALWAYS_ON: u8 = 1 << 1;

pub fn encode(s: &LightState) -> [u8; BLOB_LEN] {
	let mut b = [0u8; BLOB_LEN];
	b[0] = VERSION;
	b[1] = if s.on { FLAG_ON } else { 0 }
		| if s.policy == PowerOnPolicy::AlwaysOn { FLAG_ALWAYS_ON } else { 0 };
	[b[2], b[3], b[4]] = s.colour.array();
	b[5] = s.brightness;
	b[6] = s.effect.id();
	b
}

pub fn decode(b: &[u8]) -> Option<LightState> {
	if b.len() != BLOB_LEN || b[0] != VERSION {
		return None;
	}
	Some(LightState {
		on: b[1] & FLAG_ON != 0,
		colour: Colour::new(b[2], b[3], b[4]),
		brightness: b[5],
		effect: EffectKind::from_id(b[6])?,
		policy: if b[1] & FLAG_ALWAYS_ON != 0 {
			PowerOnPolicy::AlwaysOn
		} else {
			PowerOnPolicy::Restore
		},
	})
}

#[cfg(test)]
mod tests {
	use super::*;

	fn sample() -> LightState {
		LightState {
			on: true,
			colour: Colour::new(255, 180, 110),
			brightness: 160,
			effect: EffectKind::Twinkle,
			policy: PowerOnPolicy::Restore,
		}
	}

	#[test]
	fn roundtrip() {
		let mut s = sample();
		assert_eq!(decode(&encode(&s)), Some(s));
		s.on = false;
		s.policy = PowerOnPolicy::AlwaysOn;
		s.effect = EffectKind::Fire;
		assert_eq!(decode(&encode(&s)), Some(s));
	}

	#[test]
	fn unknown_version_or_effect_is_factory() {
		let mut b = encode(&sample());
		b[0] = 9;
		assert_eq!(decode(&b), None);
		let mut b = encode(&sample());
		b[6] = 200;
		assert_eq!(decode(&b), None);
		assert_eq!(decode(&[]), None);
	}
}
