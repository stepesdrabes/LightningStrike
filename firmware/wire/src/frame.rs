use crate::ddp::Packet;
use crate::pack;

/// Fixture-sized buffer with device-local DDP offsets starting at zero; supports host-side splits.
pub struct Frame<const BYTES: usize> {
	buf: [u8; BYTES],
	covered: usize,
	extent: usize,
	last_extent: usize,
	/// A packed payload that failed part way through leaves bytes behind it cannot account for.
	spoiled: bool,
}

impl<const BYTES: usize> Frame<BYTES> {
	pub const fn new() -> Self {
		Self { buf: [0; BYTES], covered: 0, extent: 0, last_extent: 0, spoiled: false }
	}

	/// False when a packet addresses beyond this fixture's buffer, or when a packed payload does
	/// not decode. A packed one is unpacked straight into place, so it costs no second buffer;
	/// the price is that a failed decode has already written, so the frame is marked torn rather
	/// than pretending the packet never arrived.
	pub fn apply(&mut self, p: &Packet<'_>) -> bool {
		if p.offset > BYTES {
			return false;
		}
		let written = if p.packed {
			match pack::unpack(p.data, &mut self.buf[p.offset..]) {
				Some(n) => n,
				None => {
					self.spoiled = true;
					return false;
				}
			}
		} else {
			let end = p.offset + p.data.len();
			if end > BYTES {
				return false;
			}
			self.buf[p.offset..end].copy_from_slice(p.data);
			p.data.len()
		};

		self.covered += written;
		if p.offset + written > self.extent {
			self.extent = p.offset + written;
		}
		true
	}

	/// Gamma-corrected bytes in strip order, meaningful only before the frame is closed.
	pub fn pixels(&self) -> &[u8] {
		&self.buf[..self.extent]
	}

	/// PUSH closes the frame; false indicates missing coverage. Reset counters per frame so
	/// shrinking host splits do not leave stale torn-frame reports.
	pub fn close(&mut self) -> bool {
		let whole = self.covered == self.extent && !self.spoiled;
		self.last_extent = self.extent;
		self.covered = 0;
		self.extent = 0;
		self.spoiled = false;
		whole
	}

	pub fn last_extent(&self) -> usize {
		self.last_extent
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	fn at(offset: usize, data: &'static [u8]) -> Packet<'static> {
		Packet { push: false, seq: 1, offset, packed: false, data }
	}

	#[test]
	fn assembles_a_frame_out_of_several_packets() {
		let mut f = Frame::<9>::new();
		assert!(f.apply(&at(0, &[1, 2, 3])));
		assert!(f.apply(&at(3, &[4, 5, 6, 7, 8, 9])));
		assert_eq!(f.pixels(), &[1, 2, 3, 4, 5, 6, 7, 8, 9]);
		assert!(f.close());
		assert_eq!(f.last_extent(), 9);
	}

	#[test]
	fn calls_a_frame_with_a_hole_in_it_torn() {
		let mut f = Frame::<9>::new();
		f.apply(&at(0, &[1, 2, 3]));
		f.apply(&at(6, &[7, 8, 9]));
		assert!(!f.close());
	}

	#[test]
	fn refuses_a_packet_that_runs_past_the_buffer() {
		let mut f = Frame::<6>::new();
		assert!(!f.apply(&at(4, &[1, 2, 3])));
		assert_eq!(f.pixels(), &[] as &[u8]);
	}

	#[test]
	fn unpacks_a_packed_packet_into_place() {
		let mut f = Frame::<9>::new();
		// Three pixels: 1, 2, 3 red and nothing else, packed.
		let packed = [0x00, 0x09, 0x11, 0x16, 0xd2];
		assert!(f.apply(&Packet { push: true, seq: 1, offset: 0, packed: true, data: &packed }));
		assert_eq!(f.pixels(), &[1, 0, 0, 2, 0, 0, 3, 0, 0]);
		assert!(f.close());
	}

	#[test]
	fn refuses_a_packed_payload_that_does_not_decode() {
		let mut f = Frame::<9>::new();
		let truncated = [0x00, 0x09, 0x01];
		assert!(!f.apply(&Packet {
			push: true,
			seq: 1,
			offset: 0,
			packed: true,
			data: &truncated
		}));
	}

	#[test]
	fn forgets_the_extent_between_frames() {
		let mut f = Frame::<9>::new();
		f.apply(&at(0, &[0; 9]));
		assert!(f.close());
		f.apply(&at(0, &[0; 3]));
		assert!(f.close());
		assert_eq!(f.last_extent(), 3);
	}
}
