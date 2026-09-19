use embassy_rp::Peripherals;
use embassy_rp::peripherals::PIO1;
use embassy_rp::pio::Pio;
use embassy_rp::pio_programs::ws2812::{PioWs2812Program, Rgbw, RgbwPioWs2812};
use embassy_time::{Duration, Timer};
use room_light::state::{Colour, EffectKind, LightState, PowerOnPolicy};
use smart_leds::RGBW;

use crate::board::{Board, Store};
use crate::fixture::rgbww::{self, BLACK, LATCH_TOP_UP_US, SLOTS, wire};
use crate::irq::Irqs;

pub const KIND: &str = "sk6812";

/// Address count, not LED count: grouped 12 V reels may have 100 drivers versus 300 per-LED.
/// Selftest measures density; over-counting costs wire time while under-counting rejects host regions.
const ADDRESSES: usize = 300;

/// Low selftest duty limits peak all-emitter draw and protects imperfect bench supply wiring.
const PROBE: u8 = 96;

/// Only the ratio between the two trim frames carries information.
const TRIM_PROBE: u8 = 160;

/// Five-metre RGBWW bench fixture. Selftest measures byte order, address density, and white
/// ratio before normal single-run playback.
pub struct Fixture {
	line: RgbwPioWs2812<'static, PIO1, 0, ADDRESSES, Rgbw>,
	buf: [RGBW<u8>; ADDRESSES],
}

impl Fixture {
	pub const KIND: &'static str = KIND;
	pub const HOSTNAME: &'static str = "room-bench";
	pub const PIXELS: usize = ADDRESSES;
	/// RGB24 on the wire; the fourth emitter is the board's business.
	pub const BYTES: usize = Self::PIXELS * 3;
	pub const ENGINE_PERIOD: Duration = Duration::from_millis(25);
	/// The frame's defaults, so what is judged on the table is what will hang on the wall.
	pub const DEFAULTS: LightState = LightState {
		on: true,
		colour: Colour::new(255, 180, 110),
		brightness: 160,
		effect: EffectKind::Twinkle,
		policy: PowerOnPolicy::Restore,
	};
	pub const EFFECTS: &'static [EffectKind] = &EffectKind::ALL;

	/// GP2, through the level shifter.
	pub fn claim(p: Peripherals) -> (Self, Board, Store) {
		let mut pio = Pio::new(p.PIO1, Irqs);
		let program = PioWs2812Program::new(&mut pio.common);

		// Driver Rgbw packing is identity; SLOTS alone records measured wire order.
		let line = RgbwPioWs2812::with_color_order(
			&mut pio.common,
			pio.sm0,
			p.DMA_CH2,
			Irqs,
			p.PIN_2,
			&program,
		);
		let fixture = Self { line, buf: [BLACK; ADDRESSES] };

		let board = Board {
			usb: p.USB,
			pio: p.PIO0,
			dma: p.DMA_CH0,
			pwr: p.PIN_23,
			cs: p.PIN_25,
			dio: p.PIN_24,
			clk: p.PIN_29,
			button: p.PIN_18,
		};
		(fixture, board, Store { flash: p.FLASH, dma: p.DMA_CH1, watchdog: p.WATCHDOG })
	}

	/// Selftest: raw bytes 0/1/2/3 identify SLOTS; metre marks distinguish 100/300 addresses;
	/// a moving pixel checks continuity; equal-duty RGB/W compares trim. Raw writes bypass SLOTS.
	pub async fn selftest(&mut self) {
		for byte in 0..4 {
			let mut bytes = [0u8; 4];
			bytes[byte] = PROBE;
			self.buf.fill(wire(bytes));
			self.write().await;
			Timer::after_millis(1500).await;
		}

		self.buf.fill(BLACK);
		for i in (0..ADDRESSES).step_by(5) {
			self.buf[i] = if i % 20 == 0 { wire([PROBE; 4]) } else { wire([PROBE, 0, 0, 0]) };
		}
		self.write().await;
		Timer::after_millis(4000).await;

		let steps = 40;
		for step in 0..=steps {
			self.buf.fill(BLACK);
			self.buf[step * (ADDRESSES - 1) / steps] = wire([PROBE; 4]);
			self.write().await;
			Timer::after_millis(30).await;
		}

		for emitters in [[TRIM_PROBE, TRIM_PROBE, TRIM_PROBE, 0], [0, 0, 0, TRIM_PROBE]] {
			let mut bytes = [0u8; 4];
			for (i, &level) in emitters.iter().enumerate() {
				bytes[SLOTS[i]] = level;
			}
			self.buf.fill(wire(bytes));
			self.write().await;
			Timer::after_millis(1500).await;
		}

		self.blank().await;
	}

	/// The engine's frame, linear RGBW; the measured trims are applied here and nowhere above.
	pub async fn show(&mut self, out: &[[u16; 4]]) {
		for (i, px) in self.buf.iter_mut().enumerate() {
			*px = rgbww::pack16(out[i]);
		}
		self.write().await;
	}

	/// The host owns gamma, so nothing here rescales.
	pub async fn present(&mut self, pixels: &[u8]) {
		rgbww::unpack(pixels, &mut self.buf);
		self.write().await;
	}

	async fn blank(&mut self) {
		self.buf.fill(BLACK);
		self.write().await;
	}

	async fn write(&mut self) {
		self.line.write(&self.buf).await;
		Timer::after_micros(LATCH_TOP_UP_US).await;
	}
}
