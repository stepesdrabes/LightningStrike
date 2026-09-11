//! Optional GPIO10 WS2812 status: solid joining, blinking online. Disabled by default so it
//! does not compete with the lamp. Both feature builds keep the same Status/task interface.

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

	/// Keep status dim enough not to compete with the fixture.
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
		/// Drop peripherals to leave GPIO10 as input and the LED at its dark power-on state.
		pub fn new(_rmt: RMT<'static>, _pin: GPIO10<'static>) -> Self {
			Self
		}
	}

	/// Park the disabled task to keep its interface stable; one slot, no wake-ups.
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
