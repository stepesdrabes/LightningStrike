use core::fmt::{Display, Formatter, Result, Write};

use heapless::String;

pub const LINE_CAP: usize = 192;

/// Integer-only interval counters avoid soft-float; formatting stays outside receive handling.
pub struct Stats {
	pub packets: u32,
	pub bytes: u32,
	pub frames: u32,
	pub seq_gaps: u32,
	pub bad: u32,
	pub out_of_range: u32,
	pub torn: u32,
	gap_min_us: u32,
	gap_max_us: u32,
	asm_max_us: u32,
	led_max_us: u32,
	late: [u32; 3],
}

impl Stats {
	pub const fn new() -> Self {
		Self {
			packets: 0,
			bytes: 0,
			frames: 0,
			seq_gaps: 0,
			bad: 0,
			out_of_range: 0,
			torn: 0,
			gap_min_us: u32::MAX,
			gap_max_us: 0,
			asm_max_us: 0,
			led_max_us: 0,
			late: [0; 3],
		}
	}

	/// Microseconds: gap is PUSH-to-PUSH, assembly first-packet-to-PUSH, LED is presentation cost.
	pub fn on_frame(&mut self, gap_us: u32, asm_us: u32, led_us: u32) {
		self.frames += 1;
		self.gap_min_us = self.gap_min_us.min(gap_us);
		self.gap_max_us = self.gap_max_us.max(gap_us);
		self.asm_max_us = self.asm_max_us.max(asm_us);
		self.led_max_us = self.led_max_us.max(led_us);

		// A max alone cannot tell one stumble from constant stutter.
		match gap_us {
			g if g > 100_000 => self.late[2] += 1,
			g if g > 50_000 => self.late[1] += 1,
			g if g > 20_000 => self.late[0] += 1,
			_ => {}
		}
	}

	/// One line for both the console and the stats datagram, resetting the interval counters.
	pub fn drain(&mut self, uptime_s: u64, elapsed_ms: u64, pixels: usize) -> String<LINE_CAP> {
		let ms = elapsed_ms.max(1);
		let gap_min = if self.frames == 0 { 0 } else { self.gap_min_us };

		let mut line = String::new();
		let _ = write!(
			line,
			"up {}s  {} px  {} pkt/s  {} KB/s  {} fps  gap {}/{} ms  late {}/{}/{}  asm {} ms  \
			 led {} us  seqgap {}  bad {}  oob {}  torn {}",
			uptime_s,
			pixels,
			self.packets as u64 * 1000 / ms,
			tenths(self.bytes as u64 * 1000 / 1024, ms),
			tenths(self.frames as u64 * 1000, ms),
			Tenths(gap_min / 100),
			Tenths(self.gap_max_us / 100),
			self.late[0],
			self.late[1],
			self.late[2],
			Tenths(self.asm_max_us / 100),
			self.led_max_us,
			self.seq_gaps,
			self.bad,
			self.out_of_range,
			self.torn
		);

		*self = Self::new();
		line
	}
}

impl Default for Stats {
	fn default() -> Self {
		Self::new()
	}
}

struct Tenths(u32);

impl Display for Tenths {
	fn fmt(&self, f: &mut Formatter<'_>) -> Result {
		write!(f, "{}.{}", self.0 / 10, self.0 % 10)
	}
}

fn tenths(n: u64, d: u64) -> Tenths {
	Tenths((n * 10 / d) as u32)
}

#[cfg(test)]
mod tests {
	use super::*;

	/// Pinned to the parseTelemetry fixture in apps/web; both sides share the wire contract.
	#[test]
	fn formats_the_line_the_app_parses() {
		let mut s = Stats::new();
		s.packets = 120;
		s.bytes = 130_800;
		for _ in 0..60 {
			s.on_frame(16_600, 2_100, 210);
		}
		s.gap_min_us = 15_900;
		s.gap_max_us = 17_800;

		assert_eq!(
			s.drain(42, 1000, 720).as_str(),
			"up 42s  720 px  120 pkt/s  127.7 KB/s  60.0 fps  gap 15.9/17.8 ms  late 0/0/0  \
			 asm 2.1 ms  led 210 us  seqgap 0  bad 0  oob 0  torn 0"
		);
	}

	#[test]
	fn buckets_a_stall_by_how_far_late_it_was() {
		let mut s = Stats::new();
		s.on_frame(25_000, 0, 0);
		s.on_frame(60_000, 0, 0);
		s.on_frame(316_000, 0, 0);
		assert!(s.drain(0, 1000, 0).as_str().contains("late 1/1/1"));
	}

	/// A drained interval starts from nothing, or one bad second would colour every later one.
	#[test]
	fn resets_every_counter_on_drain() {
		let mut s = Stats::new();
		s.bad = 7;
		s.on_frame(90_000, 5_000, 900);
		s.drain(0, 1000, 0);
		let line = s.drain(1, 1000, 0);
		assert!(line.as_str().contains("bad 0"));
		assert!(line.as_str().contains("late 0/0/0"));
		assert!(line.as_str().contains("gap 0.0/0.0 ms"));
	}
}
