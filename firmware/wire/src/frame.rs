use crate::ddp::Packet;

/// Fixture-sized buffer with device-local DDP offsets starting at zero; supports host-side splits.
pub struct Frame<const BYTES: usize> {
	buf: [u8; BYTES],
	covered: usize,
	extent: usize,
	last_extent: usize,
}

impl<const BYTES: usize> Frame<BYTES> {
	pub const fn new() -> Self {
		Self { buf: [0; BYTES], covered: 0, extent: 0, last_extent: 0 }
	}

	/// False when a packet addresses beyond this fixture's buffer.
	pub fn apply(&mut self, p: &Packet<'_>) -> bool {
		let end = p.offset + p.data.len();
		if end > BYTES {
			return false;
		}

		self.buf[p.offset..end].copy_from_slice(p.data);
		self.covered += p.data.len();
		if end > self.extent {
			self.extent = end;
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
		let whole = self.covered == self.extent;
		self.last_extent = self.extent;
		self.covered = 0;
		self.extent = 0;
		whole
	}

	pub fn last_extent(&self) -> usize {
		self.last_extent
	}
}

impl<const BYTES: usize> Default for Frame<BYTES> {
	fn default() -> Self {
		Self::new()
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	fn at(offset: usize, data: &'static [u8]) -> Packet<'static> {
		Packet { push: false, seq: 1, offset, data }
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
	fn forgets_the_extent_between_frames() {
		let mut f = Frame::<9>::new();
		f.apply(&at(0, &[0; 9]));
		assert!(f.close());
		f.apply(&at(0, &[0; 3]));
		assert!(f.close());
		assert_eq!(f.last_extent(), 3);
	}
}
