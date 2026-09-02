use embassy_rp::Peripherals;
use embassy_rp::peripherals::PIO1;
use embassy_rp::pio::Pio;
use embassy_rp::pio_programs::ws2812::{PioWs2812Program, Rgbw, RgbwPioWs2812};
use embassy_time::{Duration, Timer};
use room_light::effects::twinkle;
use smart_leds::RGBW;

use crate::board::Board;
use crate::fixture::rgbww::{self, BLACK, LATCH_TOP_UP_US, SLOTS, wire};
use crate::irq::Irqs;

pub const KIND: &str = "sk6812";

/// Addresses on the line, not LEDs: a 12 V part that groups three LEDs to one driver makes a 5 m
/// reel 100, a per-LED part makes it 300, and the ruler step of the selftest says which. 300 is
/// the permissive error, since over-counting only costs wire time where under-counting rejects
/// every region the app can point at.
const ADDRESSES: usize = 300;

/// Well under full scale: every emitter lit across the whole run is this strip's peak draw, and
/// the wire between supply and strip is the first thing a bench rig gets wrong.
const PROBE: u8 = 96;

/// Only the ratio between the two trim frames carries information.
const TRIM_PROBE: u8 = 160;

/// 5 m of RGBWW on one data line, on a table. A reel does not come labelled, so the selftest
/// reads three things off it by eye: byte order, addresses per metre and the white ratio. After
/// that it is an ordinary fixture; point the app at a single run rather than the whole room.
pub struct Fixture {
	line: RgbwPioWs2812<'static, PIO1, 0, ADDRESSES, Rgbw>,
	buf: [RGBW<u8>; ADDRESSES],
	idle_t: u32,
}

impl Fixture {
	pub const KIND: &'static str = KIND;
	pub const HOSTNAME: &'static str = "room-bench";
	pub const PIXELS: usize = ADDRESSES;
	/// RGB24 on the wire; the fourth emitter is the board's business.
	pub const BYTES: usize = Self::PIXELS * 3;
	pub const IDLE_PERIOD: Duration = Duration::from_millis(25);

	/// GP2, through the level shifter.
	pub fn claim(p: Peripherals) -> (Self, Board) {
		let mut pio = Pio::new(p.PIO1, Irqs);
		let program = PioWs2812Program::new(&mut pio.common);

		// `Rgbw` is the driver's identity packing, so `SLOTS` stays the only place the real order
		// lives.
		let line = RgbwPioWs2812::with_color_order(
			&mut pio.common,
			pio.sm0,
			p.DMA_CH2,
			Irqs,
			p.PIN_2,
			&program,
		);
		let fixture = Self { line, buf: [BLACK; ADDRESSES], idle_t: 0 };

		let board = Board {
			usb: p.USB,
			pio: p.PIO0,
			dma: p.DMA_CH0,
			pwr: p.PIN_23,
			cs: p.PIN_25,
			dio: p.PIN_24,
			clk: p.PIN_29,
		};
		(fixture, board)
	}

	/// Byte order: bytes 0, 1, 2, 3 alone, 1.5 s each, and the colours in that order are `SLOTS`.
	/// Density: bright marks per metre, one is 100 addresses and three is 300. Continuity: one
	/// pixel down the run. Trim: R+G+B, then white alone, same duty. The first three write raw
	/// bytes, so a wrong `SLOTS` cannot make them unreadable.
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

	pub async fn idle(&mut self) {
		self.idle_t = self.idle_t.wrapping_add(1);
		let gain = (self.idle_t.min(twinkle::FADE) * 256 / twinkle::FADE).min(256);
		for (i, px) in self.buf.iter_mut().enumerate() {
			*px = rgbww::pack16(twinkle::twinkle(i as u32, self.idle_t, gain));
		}
		self.write().await;
	}

	pub async fn idle_forever(&mut self) -> ! {
		loop {
			self.idle().await;
			Timer::after(Self::IDLE_PERIOD).await;
		}
	}

	/// The host owns gamma, so nothing here rescales.
	pub async fn present(&mut self, pixels: &[u8]) {
		self.idle_t = 0;
		rgbww::unpack(pixels, &mut self.buf);
		self.write().await;
	}

	pub async fn blank(&mut self) {
		self.buf.fill(BLACK);
		self.write().await;
	}

	async fn write(&mut self) {
		self.line.write(&self.buf).await;
		Timer::after_micros(LATCH_TOP_UP_US).await;
	}
}
