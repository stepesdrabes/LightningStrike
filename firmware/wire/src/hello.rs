use core::fmt::Write;

use heapless::String;

/// Query ? starts with 0x3f; DDP version 1 starts with high bits 01, so parsers cannot both claim it.
const QUERY: &[u8] = b"?room-node";

pub const LINE_CAP: usize = 128;

/// Binary-supplied identity keeps this crate independent of board type.
pub struct Identity<'a> {
	pub hostname: &'a str,
	pub firmware: &'a str,
	pub pixels: usize,
	pub ddp_port: u16,
	pub stats_port: u16,
	/// One kind per output, `+`-separated; the host asks whether any of them emits.
	pub leds: &'a str,
	/// Control port appended for forward-compatible token readers.
	pub http_port: u16,
}

pub fn is_query(buf: &[u8]) -> bool {
	buf.starts_with(QUERY)
}

/// Reply to the asker's port without requiring prior DDP, unlike telemetry. room-node identifies the reply.
pub fn line(id: &Identity<'_>, uptime_s: u64) -> String<LINE_CAP> {
	let mut s = String::new();
	let _ = write!(
		s,
		"room-node host {} fw {} up {}s px {} ddp {} stats {} leds {} http {}",
		id.hostname,
		id.firmware,
		uptime_s,
		id.pixels,
		id.ddp_port,
		id.stats_port,
		id.leds,
		id.http_port
	);
	s
}

#[cfg(test)]
mod tests {
	use super::*;

	const FRAME: Identity<'static> = Identity {
		hostname: "room-frame",
		firmware: "0.2.0",
		pixels: 720,
		ddp_port: 4048,
		stats_port: 4049,
		leds: "sk6812",
		http_port: 80,
	};

	/// Pinned to the parseIdentity fixture in apps/web; both sides share the wire contract.
	#[test]
	fn formats_the_line_the_app_parses() {
		assert_eq!(
			line(&FRAME, 42).as_str(),
			"room-node host room-frame fw 0.2.0 up 42s px 720 ddp 4048 stats 4049 leds sk6812 http 80"
		);
	}

	#[test]
	fn joins_several_outputs_rather_than_naming_one() {
		let both = Identity { leds: "monitor+lamp", ..FRAME };
		assert!(line(&both, 0).as_str().contains("leds monitor+lamp "));
	}

	#[test]
	fn answers_only_its_own_query() {
		assert!(is_query(b"?room-node"));
		assert!(is_query(b"?room-node\n"));
		assert!(!is_query(b"?something-else"));
		// A DDP version-1 header, which must never be mistaken for a query.
		assert!(!is_query(&[0x41, 1, 0x0b, 1, 0, 0, 0, 0, 0, 3]));
	}
}
