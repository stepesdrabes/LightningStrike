//! The onboard WS2812 on GPIO10, which is the only thing this board can say without a console.
//! Solid while it is still joining, a short blink once it is on the network - the two states the
//! Pico shows on its radio LED, in colour because this one can.
//!
//! **Behind `--features status-led`, off by default.** The lamp stands in a room rather than a
//! rack, and a second light beside the fixture reads as a fault rather than an instrument. Both
//! builds keep the same type and task, so `net::join`, which needs a `Status` to show the joining
//! state, does not know which one it is in.

#[cfg(feature = "status-led")]
mod on {
	use embassy_net::Stack;
	use embassy_time::Timer;
	use esp_hal::Async;
	use esp_hal::gpio::Level;
	use esp_hal::peripherals::{GPIO10, RMT};
	use esp_hal::rmt::{Channel, PulseCode, Rmt, Tx, TxChannelConfig, TxChannelCreator};
	use esp_hal::time::Rate;

	/// 12.5 ns a tick at 80 MHz, so 350 ns and 900 ns either way round makes the 1.25 us bit.
	const T0H: u16 = 28;
	const T0L: u16 = 72;
	const T1H: u16 = 72;
	const T1L: u16 = 28;

	/// Dim on purpose: this sits beside the lamp it reports on, and a status light that competes
	/// with the fixture is a distraction rather than an instrument.
	const JOINING: [u8; 3] = [18, 5, 0];
	const UP: [u8; 3] = [0, 14, 4];
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

	/// Reads the stack rather than being told, so a dropped link puts it back to solid by itself.
	#[embassy_executor::task]
	pub async fn status_task(mut status: Status, stack: Stack<'static>) -> ! {
		loop {
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
	}
}

#[cfg(not(feature = "status-led"))]
mod off {
	use embassy_net::Stack;
	use esp_hal::peripherals::{GPIO10, RMT};

	pub struct Status;

	impl Status {
		/// Takes the peripherals and drops them, so GPIO10 goes back to an input and the LED is
		/// left holding whatever power-on gave it, which is dark.
		pub fn new(_rmt: RMT<'static>, _pin: GPIO10<'static>) -> Self {
			Self
		}
	}

	/// Parked rather than left unspawned, so the signature above it does not change with the
	/// feature. It costs one task slot and no wake-ups.
	#[embassy_executor::task]
	pub async fn status_task(_status: Status, _stack: Stack<'static>) -> ! {
		loop {
			core::future::pending::<()>().await;
		}
	}
}

#[cfg(feature = "status-led")]
pub use on::{Status, status_task};

#[cfg(not(feature = "status-led"))]
pub use off::{Status, status_task};
