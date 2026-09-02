//! What a light remembers, and the two modes it can be in.

/// What wall power coming back does. The lamp ships AlwaysOn so its switch behaves like a light
/// switch; the frame ships Restore so a midnight power blip cannot relight a whole wall.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum PowerOnPolicy {
	Restore,
	AlwaysOn,
}

impl PowerOnPolicy {
	pub fn name(self) -> &'static str {
		match self {
			Self::Restore => "restore",
			Self::AlwaysOn => "always-on",
		}
	}

	pub fn from_name(name: &str) -> Option<Self> {
		match name {
			"restore" => Some(Self::Restore),
			"always-on" => Some(Self::AlwaysOn),
			_ => None,
		}
	}
}

/// Serializes as its lowercase name, which keeps `name()` and the JSON in one place.
#[derive(Clone, Copy, PartialEq, Eq, Debug, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum EffectKind {
	Wash,
	Twinkle,
	Fire,
}

impl EffectKind {
	pub const ALL: [Self; 3] = [Self::Wash, Self::Twinkle, Self::Fire];

	pub fn id(self) -> u8 {
		match self {
			Self::Wash => 0,
			Self::Twinkle => 1,
			Self::Fire => 2,
		}
	}

	pub fn from_id(id: u8) -> Option<Self> {
		Self::ALL.into_iter().find(|e| e.id() == id)
	}

	pub fn name(self) -> &'static str {
		match self {
			Self::Wash => "wash",
			Self::Twinkle => "twinkle",
			Self::Fire => "fire",
		}
	}

	pub fn from_name(name: &str) -> Option<Self> {
		Self::ALL.into_iter().find(|e| e.name() == name)
	}
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Colour {
	pub r: u8,
	pub g: u8,
	pub b: u8,
}

impl Colour {
	pub const fn new(r: u8, g: u8, b: u8) -> Self {
		Self { r, g, b }
	}

	pub fn array(self) -> [u8; 3] {
		[self.r, self.g, self.b]
	}

	pub fn from_hex(s: &str) -> Option<Self> {
		let hex = s.strip_prefix('#')?.as_bytes();
		if hex.len() != 6 {
			return None;
		}
		let nib = |c: u8| match c {
			b'0'..=b'9' => Some(c - b'0'),
			b'a'..=b'f' => Some(c - b'a' + 10),
			b'A'..=b'F' => Some(c - b'A' + 10),
			_ => None,
		};
		let byte = |i: usize| Some(nib(hex[i])? << 4 | nib(hex[i + 1])?);
		Some(Self { r: byte(0)?, g: byte(2)?, b: byte(4)? })
	}

	/// `#rrggbb`, ready to serialize.
	pub fn hex(self) -> [u8; 7] {
		const DIGITS: &[u8; 16] = b"0123456789abcdef";
		let mut out = [b'#'; 7];
		for (i, c) in self.array().into_iter().enumerate() {
			out[1 + i * 2] = DIGITS[(c >> 4) as usize];
			out[2 + i * 2] = DIGITS[(c & 0xf) as usize];
		}
		out
	}
}

/// The remembered light: what soft-off keeps and power-on fades back into.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct LightState {
	pub on: bool,
	pub colour: Colour,
	pub brightness: u8,
	pub effect: EffectKind,
	pub policy: PowerOnPolicy,
}

/// Party is entered by DDP arriving, never by hand; `muted` is a party-session flag, which is
/// what lets a stream take over a soft-off light and an explicit off still win afterwards.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Mode {
	Smart,
	Party { muted: bool },
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn hex_roundtrip() {
		let c = Colour::new(0xff, 0xb4, 0x6e);
		assert_eq!(&c.hex(), b"#ffb46e");
		assert_eq!(Colour::from_hex("#ffb46e"), Some(c));
		assert_eq!(Colour::from_hex("#FFB46E"), Some(c));
		assert_eq!(Colour::from_hex("ffb46e"), None);
		assert_eq!(Colour::from_hex("#ffb46"), None);
		assert_eq!(Colour::from_hex("#ffb46g"), None);
	}

	#[test]
	fn names_roundtrip() {
		for e in EffectKind::ALL {
			assert_eq!(EffectKind::from_name(e.name()), Some(e));
			assert_eq!(EffectKind::from_id(e.id()), Some(e));
		}
		assert_eq!(PowerOnPolicy::from_name("restore"), Some(PowerOnPolicy::Restore));
		assert_eq!(PowerOnPolicy::from_name("always-on"), Some(PowerOnPolicy::AlwaysOn));
		assert_eq!(PowerOnPolicy::from_name("alwayson"), None);
	}
}
