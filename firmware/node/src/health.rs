//! Confirming a new firmware, and resetting one that has stopped answering.
//!
//! The bootloader starts the watchdog before it hands over, so an image that hangs on the way up
//! is reset without anyone walking to the board. This module adopts that watchdog and keeps
//! feeding it.
//!
//! On a trial boot, the first one after an update, feeding stops at [`TRIAL`] unless the image
//! has reached the network by then. The reset that follows is the whole mechanism: the
//! bootloader sees a slot that was swapped but never confirmed and puts the old image back. An
//! update that joins the network confirms itself and the trial ends.

use core::sync::atomic::{AtomicBool, Ordering};

use embassy_futures::select::{Either, select};
use embassy_rp::watchdog::Watchdog;
use embassy_sync::blocking_mutex::raw::CriticalSectionRawMutex;
use embassy_sync::signal::Signal;
use embassy_time::{Duration, Instant, Timer};

/// Must match the bootloader's window, and the RP2040 cannot count past about 8.3 s anyway.
const TIMEOUT: Duration = Duration::from_secs(8);

/// Comfortably inside `TIMEOUT`, so one late poll is not a reset.
const FEED: Duration = Duration::from_secs(2);

/// How long a new image has to reach the network before it is treated as a bad update. Long
/// enough for a slow DHCP lease and a retry, short enough that nobody waits out a dark room.
const TRIAL: Duration = Duration::from_secs(90);

/// Set once the running image has proved it can reach the network.
static CONFIRMED: AtomicBool = AtomicBool::new(false);

/// Raised after a staged image is committed, so the reset happens once the response is sent
/// rather than in the middle of writing it.
static REBOOT: Signal<CriticalSectionRawMutex, ()> = Signal::new();

pub fn confirm() {
	CONFIRMED.store(true, Ordering::Relaxed);
}

pub fn reboot() {
	REBOOT.signal(());
}

/// Feeds the watchdog, and stops if a trial boot runs out of time to prove itself.
#[embassy_executor::task]
pub async fn watch(mut watchdog: Watchdog, trial: bool) -> ! {
	let deadline = Instant::now() + TRIAL;

	loop {
		watchdog.feed(TIMEOUT);

		match select(Timer::after(FEED), REBOOT.wait()).await {
			Either::First(()) => {}
			Either::Second(()) => watchdog.trigger_reset(),
		}

		if trial && !CONFIRMED.load(Ordering::Relaxed) && Instant::now() >= deadline {
			// Nothing more to do but stop feeding. The reset is what tells the bootloader that
			// this image never came up, and the old one goes back.
			loop {
				Timer::after(TIMEOUT).await;
			}
		}
	}
}
