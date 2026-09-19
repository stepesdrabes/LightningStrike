//! JSON DTOs and the validated Patch/Command vocabulary sent to the engine.

use serde::{Deserialize, Serialize, Serializer};

use crate::state::{Colour, EffectKind, PowerOnPolicy};

/// One request's worth of changes, applied atomically.
#[derive(Default, Clone, Copy, PartialEq, Eq, Debug)]
pub struct Patch {
	pub power: Option<bool>,
	pub colour: Option<Colour>,
	pub brightness: Option<u8>,
	pub effect: Option<EffectKind>,
	pub policy: Option<PowerOnPolicy>,
}

#[derive(Clone, Copy, Debug)]
pub enum Command {
	Patch(Patch),
	Identify,
}

#[derive(Serialize, Clone, Copy, Debug)]
pub struct StateDto {
	pub power: &'static str,
	pub colour: HexColour,
	pub brightness: u8,
	pub effect: &'static str,
	#[serde(rename = "powerOn")]
	pub power_on: &'static str,
	pub mode: &'static str,
}

#[derive(Clone, Copy, Debug)]
pub struct HexColour(pub Colour);

impl Serialize for HexColour {
	fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
		let hex = self.0.hex();
		s.serialize_str(core::str::from_utf8(&hex).unwrap_or("#000000"))
	}
}

#[derive(Deserialize)]
pub struct PatchDto<'a> {
	#[serde(default)]
	pub power: Option<&'a str>,
	#[serde(default)]
	pub colour: Option<&'a str>,
	#[serde(default)]
	pub brightness: Option<u16>,
	#[serde(default)]
	pub effect: Option<&'a str>,
	#[serde(default, rename = "powerOn")]
	pub power_on: Option<&'a str>,
}

impl PatchDto<'_> {
	/// Vocabulary and range checks; `effects` is what this fixture actually runs.
	pub fn validate(&self, effects: &[EffectKind]) -> Result<Patch, &'static str> {
		let mut p = Patch::default();
		if let Some(v) = self.power {
			p.power = Some(match v {
				"on" => true,
				"off" => false,
				_ => return Err("power on|off"),
			});
		}
		if let Some(v) = self.colour {
			p.colour = Some(Colour::from_hex(v).ok_or("colour #rrggbb")?);
		}
		if let Some(v) = self.brightness {
			if v > 255 {
				return Err("brightness 0..255");
			}
			p.brightness = Some(v as u8);
		}
		if let Some(v) = self.effect {
			let e = EffectKind::from_name(v).ok_or("effect unknown")?;
			if !effects.contains(&e) {
				return Err("effect not on this fixture");
			}
			p.effect = Some(e);
		}
		if let Some(v) = self.power_on {
			p.policy = Some(PowerOnPolicy::from_name(v).ok_or("powerOn restore|always-on")?);
		}
		Ok(p)
	}
}

/// The hello line as JSON, so a bridge never needs the UDP side.
#[derive(Serialize, Debug)]
pub struct InfoDto<'a> {
	pub name: &'a str,
	/// Board IPv4 dotted-quad, empty before DHCP. Needed for subnet discovery from .local pages,
	/// whose browser cannot resolve the address itself.
	pub ip: &'a str,
	pub firmware: &'a str,
	#[serde(rename = "uptimeS")]
	pub uptime_s: u64,
	pub pixels: usize,
	#[serde(rename = "ddpPort")]
	pub ddp_port: u16,
	#[serde(rename = "statsPort")]
	pub stats_port: u16,
	pub leds: &'a str,
	pub effects: &'a [EffectKind],
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn state_serializes_to_the_documented_shape() {
		let dto = StateDto {
			power: "on",
			colour: HexColour(Colour::new(0xff, 0xb4, 0x6e)),
			brightness: 160,
			effect: "twinkle",
			power_on: "restore",
			mode: "party",
		};
		let mut buf = [0u8; 160];
		let n = serde_json_core::to_slice(&dto, &mut buf).unwrap();
		assert_eq!(
			core::str::from_utf8(&buf[..n]).unwrap(),
			r##"{"power":"on","colour":"#ffb46e","brightness":160,"effect":"twinkle","powerOn":"restore","mode":"party"}"##
		);
	}

	#[test]
	fn patch_parses_subsets_and_rejects_bad_values() {
		let (p, _) =
			serde_json_core::from_str::<PatchDto>(r#"{"power":"on","brightness":200}"#).unwrap();
		let patch = p.validate(&EffectKind::ALL).unwrap();
		assert_eq!(patch.power, Some(true));
		assert_eq!(patch.brightness, Some(200));
		assert_eq!(patch.colour, None);

		let (p, _) = serde_json_core::from_str::<PatchDto>(r#"{"brightness":300}"#).unwrap();
		assert_eq!(p.validate(&EffectKind::ALL), Err("brightness 0..255"));

		let (p, _) = serde_json_core::from_str::<PatchDto>(r#"{"effect":"fire"}"#).unwrap();
		assert_eq!(p.validate(&[EffectKind::Wash]), Err("effect not on this fixture"));

		let (p, _) = serde_json_core::from_str::<PatchDto>(r##"{"colour":"#12ab34"}"##).unwrap();
		assert_eq!(
			p.validate(&EffectKind::ALL).unwrap().colour,
			Some(Colour::new(0x12, 0xab, 0x34))
		);
	}

	/// The tolerant-reader stance: a field this build does not know must not fail the request.
	#[test]
	fn unknown_fields_are_ignored() {
		let parsed = serde_json_core::from_str::<PatchDto>(r#"{"power":"off","bogus":42}"#);
		match parsed {
			Ok((p, _)) => assert_eq!(p.power, Some("off")),
			Err(e) => panic!("unknown field rejected: {e:?}"),
		}
	}
}
