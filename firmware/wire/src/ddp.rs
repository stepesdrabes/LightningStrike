//! DDP over UDP, which is what WLED listens for with no configuration.

const HEADER: usize = 10;
const VERSION_MASK: u8 = 0xc0;
const VERSION_1: u8 = 0x40;
const FLAG_PUSH: u8 = 0x01;
const TYPE_RGB24: u8 = 0x0b;
/// The same pixels through [`crate::pack`]. The top bit is DDP's customer-defined flag, so no
/// standard receiver can mistake it for something it knows.
const TYPE_RGB24_PACKED: u8 = 0x8b;

pub struct Packet<'a> {
	/// End of a frame. The sequence number never marks one: it counts packets, not frames.
	pub push: bool,
	/// 1..15, wrapping 15 -> 1. Zero means the sender is not tracking sequence.
	pub seq: u8,
	/// Byte offset into this device's own buffer, not into the host's global one.
	pub offset: usize,
	/// True when `data` is a packed payload rather than the pixels themselves.
	pub packed: bool,
	pub data: &'a [u8],
}

/// None for anything this firmware does not speak, including a longer TIMECODE header.
pub fn parse(buf: &[u8]) -> Option<Packet<'_>> {
	if buf.len() < HEADER || buf[0] & VERSION_MASK != VERSION_1 {
		return None;
	}
	let packed = match buf[2] {
		TYPE_RGB24 => false,
		TYPE_RGB24_PACKED => true,
		_ => return None,
	};

	let len = u16::from_be_bytes([buf[8], buf[9]]) as usize;
	if buf.len() < HEADER + len {
		return None;
	}

	Some(Packet {
		push: buf[0] & FLAG_PUSH != 0,
		seq: buf[1] & 0x0f,
		offset: u32::from_be_bytes([buf[4], buf[5], buf[6], buf[7]]) as usize,
		packed,
		data: &buf[HEADER..HEADER + len],
	})
}

/// The sender wraps 15 -> 1 and never emits 0.
pub fn next_seq(seq: u8) -> u8 {
	if seq >= 15 { 1 } else { seq + 1 }
}

#[cfg(test)]
mod tests {
	use super::*;

	fn packet(flags: u8, kind: u8, offset: u32, data: &[u8]) -> heapless::Vec<u8, 64> {
		let mut v = heapless::Vec::new();
		v.extend_from_slice(&[flags, 1, kind, 1]).unwrap();
		v.extend_from_slice(&offset.to_be_bytes()).unwrap();
		v.extend_from_slice(&(data.len() as u16).to_be_bytes()).unwrap();
		v.extend_from_slice(data).unwrap();
		v
	}

	#[test]
	fn reads_a_frame_the_sender_actually_emits() {
		let buf = packet(VERSION_1 | FLAG_PUSH, TYPE_RGB24, 900, &[1, 2, 3]);
		let p = parse(&buf).unwrap();
		assert!(p.push);
		assert_eq!(p.seq, 1);
		assert_eq!(p.offset, 900);
		assert!(!p.packed);
		assert_eq!(p.data, &[1, 2, 3]);
	}

	#[test]
	fn reads_a_packed_frame_as_one() {
		let buf = packet(VERSION_1 | FLAG_PUSH, TYPE_RGB24_PACKED, 0, &[0, 3, 0]);
		assert!(parse(&buf).unwrap().packed);
	}

	#[test]
	fn a_packet_that_is_not_the_last_carries_no_push() {
		assert!(!parse(&packet(VERSION_1, TYPE_RGB24, 0, &[0; 3])).unwrap().push);
	}

	#[test]
	fn rejects_anything_it_does_not_speak() {
		// RGBW32, which the sender can emit and this build cannot show.
		assert!(parse(&packet(VERSION_1, 0x1b, 0, &[0; 4])).is_none());
		// Version 2 in the top two bits.
		assert!(parse(&packet(0x80, TYPE_RGB24, 0, &[0; 3])).is_none());
		assert!(parse(&[]).is_none());
		assert!(parse(&[0x41, 1, 0x0b, 1, 0, 0]).is_none());
	}

	#[test]
	fn rejects_a_length_the_datagram_does_not_carry() {
		let mut short = packet(VERSION_1, TYPE_RGB24, 0, &[1, 2, 3]);
		short.pop();
		assert!(parse(&short).is_none());
	}

	#[test]
	fn wraps_the_sequence_the_way_the_sender_does() {
		assert_eq!(next_seq(1), 2);
		assert_eq!(next_seq(15), 1);
	}
}
