//! A button on GP18 chooses which wifi.toml entry the board joins. Each press moves one entry
//! along and blinks where it landed; three seconds of quiet saves that choice and the radio
//! moves to it.

use embassy_rp::Peri;
use embassy_rp::gpio::{Input, Pull};
use embassy_rp::peripherals::PIN_18;
use embassy_sync::blocking_mutex::raw::CriticalSectionRawMutex;
use embassy_sync::signal::Signal;
use embassy_time::{Instant, Timer};
use room_wifi::{Button, POLL_MS, Selector};

use crate::persist::Persist;

/// The index to show, rendered by whoever owns the status LED. Latest wins, because a press
/// during a blink replaces the count rather than queueing behind it.
pub static BLINK: Signal<CriticalSectionRawMutex, u8> = Signal::new();

/// The settled index, for the flash owner to save.
static COMMIT: Signal<CriticalSectionRawMutex, u8> = Signal::new();

/// The settled index, for the radio to move to. Separate from COMMIT because the flash and the
/// radio have different owners and neither waits on the other.
pub static SWITCH: Signal<CriticalSectionRawMutex, u8> = Signal::new();

/// A momentary switch from GP18 to ground, pulled up on chip, so a press reads low. Sampled
/// rather than waited on, because two agreeing samples are what debounces the contacts.
#[embassy_executor::task]
pub async fn poll_task(pin: Peri<'static, PIN_18>, current: u8) -> ! {
	let pin = Input::new(pin, Pull::Up);
	let mut button = Button::new();
	let mut selector = Selector::new(current);
	let mut joined = current;
	loop {
		let now = Instant::now().as_millis();
		if button.sample(pin.is_low()) {
			BLINK.signal(selector.press(now));
		}
		if let Some(index) = selector.settled(now) {
			// Pressing all the way round to where the board already is asks for nothing.
			if index != joined {
				joined = index;
				COMMIT.signal(index);
				SWITCH.signal(index);
			}
		}
		Timer::after_millis(POLL_MS).await;
	}
}

/// The settled index, for a loop that wants it as one arm of a select.
pub async fn wait_commit() -> u8 {
	COMMIT.wait().await
}

pub async fn save(persist: &mut Persist, index: u8) {
	log::info!("wifi {} chosen", index + 1);
	persist.save_network(index).await;
}

/// Never returns: it is one arm of main's select while the first join is still in flight.
pub async fn commit(persist: &mut Persist) -> ! {
	loop {
		let index = wait_commit().await;
		save(persist, index).await;
	}
}
