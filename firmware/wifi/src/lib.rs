//! The networks a board may join and the button that chooses between them. Board-independent
//! and host-testable; the boards own the pin, the LED and the flash.

#![no_std]

/// One `[[network]]` of firmware/wifi.toml, in file order. Entry one is the first blink.
pub struct Network {
	pub ssid: &'static str,
	pub password: &'static str,
}

include!(concat!(env!("OUT_DIR"), "/networks.rs"));

/// A stored index survives wifi.toml shrinking, so a stale one falls back to the first entry.
pub fn network(index: u8) -> &'static Network {
	&NETWORKS[clamp(index) as usize]
}

pub fn clamp(index: u8) -> u8 {
	if (index as usize) < NETWORKS.len() { index } else { 0 }
}

/// Button sampling period. Two agreeing samples debounce the contacts, so a press is seen
/// after 50 ms and bounce shorter than that cannot invent one.
pub const POLL_MS: u64 = 25;

/// Quiet time after the last press before the choice is saved. Long enough to count to the
/// last entry without hurrying, short enough that a stray press settles before you walk away.
pub const COMMIT_MS: u64 = 3_000;

/// Count pulses, deliberately longer than the 60 ms heartbeat pulse either board makes, so
/// the two read as different things rather than as more of each other.
pub const BLINK_ON_MS: u64 = 200;
pub const BLINK_OFF_MS: u64 = 300;

/// Dark before the first pulse, so a heartbeat or a solid joining LED cannot be counted.
pub const BLINK_LEAD_MS: u64 = 600;

/// Dark after the last pulse, matching the commit window: nothing else may pulse between the
/// count and the reboot that confirms it, or the count cannot be trusted.
pub const BLINK_QUIET_MS: u64 = COMMIT_MS;

/// Edge detection with a two-sample debounce.
pub struct Button {
	down: bool,
	last: bool,
}

impl Default for Button {
	fn default() -> Self {
		Self::new()
	}
}

impl Button {
	/// Starts held, so a button already down when the board powers up reads as a release.
	pub const fn new() -> Self {
		Self { down: true, last: true }
	}

	/// True on the sample where a stable press begins.
	pub fn sample(&mut self, raw: bool) -> bool {
		let settled = raw == self.last;
		self.last = raw;
		if !settled || raw == self.down {
			return false;
		}
		self.down = raw;
		raw
	}
}

/// One press moves one entry along, wrapping past the last, and the blink names where it
/// landed. Counting from one instead would make a single press mean the first network, which
/// is usually the one the board is already on: a press that changes nothing.
pub struct Selector {
	index: u8,
	due_ms: Option<u64>,
}

impl Selector {
	/// Starts where the board already is, so the first press is the next entry along.
	pub const fn new(current: u8) -> Self {
		Self { index: current, due_ms: None }
	}

	/// Take one press and return the index it moved to.
	pub fn press(&mut self, now_ms: u64) -> u8 {
		self.index = (self.index + 1) % NETWORKS.len() as u8;
		self.due_ms = Some(now_ms + COMMIT_MS);
		self.index
	}

	/// The chosen index, once the window has passed with no further press.
	pub fn settled(&mut self, now_ms: u64) -> Option<u8> {
		match self.due_ms {
			Some(due) if now_ms >= due => {
				self.due_ms = None;
				Some(self.index)
			}
			_ => None,
		}
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	fn press(button: &mut Button, samples: &[bool]) -> usize {
		samples.iter().filter(|raw| button.sample(**raw)).count()
	}

	#[test]
	fn a_held_button_at_boot_is_not_a_press() {
		let mut button = Button::new();
		assert_eq!(press(&mut button, &[true, true, true, false, false]), 0);
		assert_eq!(press(&mut button, &[true, true]), 1);
	}

	#[test]
	fn bounce_shorter_than_two_samples_is_ignored() {
		let mut button = Button::new();
		press(&mut button, &[false, false]);
		// One stray low sample between releases is not a press.
		assert_eq!(press(&mut button, &[true, false, false]), 0);
		assert_eq!(press(&mut button, &[true, true, false, false, true, true]), 2);
	}

	/// The one that matters: a single press has to leave the board somewhere else, or it reads
	/// as a button that does nothing.
	#[test]
	fn one_press_moves_one_entry_along() {
		for start in 0..NETWORKS.len() as u8 {
			let moved = Selector::new(start).press(0);
			assert_eq!(moved, (start + 1) % NETWORKS.len() as u8);
			if NETWORKS.len() > 1 {
				assert_ne!(moved, start, "a press must leave the board somewhere else");
			}
		}
	}

	#[test]
	fn presses_wrap_back_round_to_where_they_started() {
		let mut selector = Selector::new(0);
		let mut now = 0;
		for _ in 0..NETWORKS.len() {
			selector.press(now);
			now += 100;
		}
		assert_eq!(selector.settled(now + COMMIT_MS), Some(0));
	}

	#[test]
	fn a_new_window_carries_on_from_the_last_choice() {
		let mut selector = Selector::new(0);
		let first = selector.press(0);
		assert_eq!(selector.settled(COMMIT_MS), Some(first));
		assert_eq!(selector.press(COMMIT_MS + 100), (first + 1) % NETWORKS.len() as u8);
	}

	#[test]
	fn quiet_settles_the_choice_once() {
		let mut selector = Selector::new(0);
		let chosen = selector.press(0);
		assert_eq!(selector.settled(COMMIT_MS - 1), None);
		assert_eq!(selector.settled(COMMIT_MS), Some(chosen));
		assert_eq!(selector.settled(COMMIT_MS + 1), None);
	}

	#[test]
	fn a_press_inside_the_window_restarts_it() {
		let mut selector = Selector::new(0);
		selector.press(0);
		selector.press(COMMIT_MS - 1);
		assert_eq!(selector.settled(COMMIT_MS), None);
		assert!(selector.settled(2 * COMMIT_MS).is_some());
	}

	#[test]
	fn a_stale_index_falls_back_to_the_first_network() {
		assert_eq!(clamp(0), 0);
		assert_eq!(clamp(NETWORKS.len() as u8), 0);
		assert_eq!(clamp(255), 0);
	}
}
