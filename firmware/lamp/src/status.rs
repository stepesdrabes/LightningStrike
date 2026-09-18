//! The C3's onboard WS2812 on GPIO10. It answers the network button on every build, because a
//! press that shows nothing cannot be counted; `status-led` adds the joining/online heartbeat,
//! which stays off by default so the lamp does not stand beside the fixture reporting on itself.

use embassy_futures::select::{Either, select};
use embassy_net::Stack;
use embassy_time::Timer;
use esp_hal::Async;
use esp_hal::gpio::Level;
use esp_hal::peripherals::{GPIO10, RMT};
use esp_hal::rmt::{Channel, PulseCode, Rmt, Tx, TxChannelConfig, TxChannelCreator};
use esp_hal::time::Rate;

use crate::select::BLINK;

/// 12.5 ns a tick at 80 MHz, so 350 ns and 900 ns either way round makes the 1.25 us bit.
const T0H: u16 = 28;
const T0L: u16 = 72;
const T1H: u16 = 72;
const T1L: u16 = 28;

/// Keep status dim enough not to compete with the fixture.
#[cfg(feature = "status-led")]
const JOINING: [u8; 3] = [18, 5, 0];
#[cfg(feature = "status-led")]
const UP: [u8; 3] = [0, 14, 4];
/// The network count, in white: it is not one of the states the other two colours name.
const COUNT: [u8; 3] = [16, 16, 16];
const DARK: [u8; 3] = [0, 0, 0];

const BITS: usize = 24;

pub struct Status {
	channel: Channel<'static, Async, Tx>,
}

impl Status {
	pub fn new(rmt: RMT<'static>, pin: GPIO10<'static>) -> Self {
		let rmt = Rmt::new(rmt, Rate::from_mhz(80)).unwrap().into_async();
		let channel = rmt
			.channel0
			.configure_tx(&TxChannelConfig::default().with_clk_divider(1))
			.unwrap()
			.with_pin(pin);
		Self { channel }
	}

	/// GRB, most significant bit first; the end marker holds the line low for the latch.
	pub async fn show(&mut self, rgb: [u8; 3]) {
		let mut buf = [PulseCode::end_marker(); BITS + 1];
		let mut i = 0;
		for byte in [rgb[1], rgb[0], rgb[2]] {
			for bit in (0..8).rev() {
				buf[i] = if (byte >> bit) & 1 == 1 {
					PulseCode::new(Level::High, T1H, Level::Low, T1L)
				} else {
					PulseCode::new(Level::High, T0H, Level::Low, T0L)
				};
				i += 1;
			}
		}
		let _ = self.channel.transmit(&buf).await;
	}
}

/// The one owner of the LED. Reads the stack rather than being told, so a dropped link puts the
/// heartbeat back to solid by itself.
#[embassy_executor::task]
pub async fn status_task(mut status: Status, stack: Stack<'static>, index: u8) -> ! {
	blink(&mut status, index).await;
	loop {
		// A press wins the race against the heartbeat, so it is answered without waiting it out.
		let event = select(BLINK.wait(), heartbeat(&mut status, stack)).await;
		if let Either::First(index) = event {
			blink(&mut status, index).await;
		}
	}
}

/// index + 1 pulses, so the first entry of wifi.toml reads as one blink, held clear of the
/// heartbeat by dark on both sides. A press during either restarts the count rather than
/// queueing a second one behind it.
async fn blink(status: &mut Status, mut index: u8) {
	loop {
		status.show(DARK).await;
		Timer::after_millis(room_wifi::BLINK_LEAD_MS).await;
		for _ in 0..=index {
			status.show(COUNT).await;
			Timer::after_millis(room_wifi::BLINK_ON_MS).await;
			status.show(DARK).await;
			Timer::after_millis(room_wifi::BLINK_OFF_MS).await;
		}
		match select(Timer::after_millis(room_wifi::BLINK_QUIET_MS), BLINK.wait()).await {
			Either::First(()) => return,
			Either::Second(next) => index = next,
		}
	}
}

/// One pass: solid joining, a blink online.
#[cfg(feature = "status-led")]
async fn heartbeat(status: &mut Status, stack: Stack<'static>) {
	if stack.is_config_up() {
		status.show(UP).await;
		Timer::after_millis(60).await;
		status.show(DARK).await;
		Timer::after_millis(940).await;
	} else {
		status.show(JOINING).await;
		Timer::after_millis(500).await;
	}
}

/// Without the feature the LED rests dark between presses, so this arm never completes.
#[cfg(not(feature = "status-led"))]
async fn heartbeat(_status: &mut Status, _stack: Stack<'static>) {
	core::future::pending().await
}
