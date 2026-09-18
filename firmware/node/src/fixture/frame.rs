use embassy_futures::join::join3;
use embassy_rp::Peripherals;
use embassy_rp::peripherals::PIO1;
use embassy_rp::pio::Pio;
use embassy_rp::pio_programs::ws2812::{PioWs2812Program, Rgbw, RgbwPioWs2812};
use embassy_time::{Duration, Timer};
use room_light::state::{Colour, EffectKind, LightState, PowerOnPolicy};
use smart_leds::RGBW;

use crate::board::{Board, Store};
use crate::fixture::rgbww::{self, BLACK, LATCH_TOP_UP_US};
use crate::irq::Irqs;

pub const KIND: &str = "sk6812";

/// A: north/east; B: south/west; C: beam. At 40 us/address, parallel lines take the longest
/// line's 11.2 ms instead of 26.8 ms for all 671 addresses in series.
const LINE_A: usize = 281;
const LINE_B: usize = 281;
const LINE_C: usize = 109;

/// Runs match core geometry at 60 LED/m. Selftest colours: N red, E green, S blue, W white,
/// beam magenta; duty 96 keeps draw well below full scale.
#[cfg(feature = "selftest")]
const RUNS: [(usize, usize, [u8; 4]); 5] = [
	(0, 170, [96, 0, 0, 0]),
	(170, 111, [0, 96, 0, 0]),
	(281, 170, [0, 0, 96, 0]),
	(451, 111, [96, 96, 96, 0]),
	(562, 109, [96, 0, 96, 0]),
];

/// Just under 3 x 2 m of SK6812 RGBWW at 60 LED/m, GP2/3/4 through level shifters: long runs
/// 170, short 111, beam 109. B and beam run opposite the host buffer so each line begins at
/// the board corner; software must reverse them.
pub struct Fixture {
	a: RgbwPioWs2812<'static, PIO1, 0, LINE_A, Rgbw>,
	b: RgbwPioWs2812<'static, PIO1, 1, LINE_B, Rgbw>,
	c: RgbwPioWs2812<'static, PIO1, 2, LINE_C, Rgbw>,
	buf_a: [RGBW<u8>; LINE_A],
	buf_b: [RGBW<u8>; LINE_B],
	buf_c: [RGBW<u8>; LINE_C],
}

impl Fixture {
	pub const KIND: &'static str = KIND;
	pub const HOSTNAME: &'static str = "room-frame";
	pub const PIXELS: usize = LINE_A + LINE_B + LINE_C;
	/// RGB24 on the wire; the fourth emitter is the board's business.
	pub const BYTES: usize = Self::PIXELS * 3;
	/// One write is 11.2 ms, so this is about as fast as the engine can run.
	pub const ENGINE_PERIOD: Duration = Duration::from_millis(25);
	/// Restore prevents power glitches relighting the room; Twinkle preserves the default boot look.
	pub const DEFAULTS: LightState = LightState {
		on: true,
		colour: Colour::new(255, 180, 110),
		brightness: 160,
		effect: EffectKind::Twinkle,
		policy: PowerOnPolicy::Restore,
	};
	pub const EFFECTS: &'static [EffectKind] = &EffectKind::ALL;

	/// cyw43 owns PIO0 SM0/DMA_CH0; strips use PIO1 and DMA_CH2+. Share one loaded PIO program.
	pub fn claim(p: Peripherals) -> (Self, Board, Store) {
		let mut pio = Pio::new(p.PIO1, Irqs);
		let program = PioWs2812Program::new(&mut pio.common);

		let fixture = Self {
			a: RgbwPioWs2812::with_color_order(
				&mut pio.common,
				pio.sm0,
				p.DMA_CH2,
				Irqs,
				p.PIN_2,
				&program,
			),
			b: RgbwPioWs2812::with_color_order(
				&mut pio.common,
				pio.sm1,
				p.DMA_CH3,
				Irqs,
				p.PIN_3,
				&program,
			),
			c: RgbwPioWs2812::with_color_order(
				&mut pio.common,
				pio.sm2,
				p.DMA_CH4,
				Irqs,
				p.PIN_4,
				&program,
			),
			buf_a: [BLACK; LINE_A],
			buf_b: [BLACK; LINE_B],
			buf_c: [BLACK; LINE_C],
		};

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
		(fixture, board, Store { flash: p.FLASH, dma: p.DMA_CH1 })
	}

	/// Optional selftest paints five runs for four seconds to reveal swapped wiring. Default boot
	/// uses the remembered fade; detailed strip measurements belong to the bench build.
	pub async fn selftest(&mut self) {
		#[cfg(feature = "selftest")]
		{
			for (from, count, emitters) in RUNS {
				self.paint(from, count, rgbww::pack(emitters));
			}
			self.write().await;
			Timer::after_millis(4000).await;
		}
	}

	/// Exercise the same reversal as show so selftest covers mapping and wiring together.
	#[cfg(feature = "selftest")]
	fn paint(&mut self, from: usize, count: usize, c: RGBW<u8>) {
		for j in from..from + count {
			if j < LINE_A {
				self.buf_a[j] = c;
			} else if j < LINE_A + LINE_B {
				self.buf_b[LINE_A + LINE_B - 1 - j] = c;
			} else {
				self.buf_c[LINE_A + LINE_B + LINE_C - 1 - j] = c;
			}
		}
	}

	/// The engine's frame, linear RGBW; the measured trims are applied here and nowhere above.
	pub async fn show(&mut self, out: &[[u16; 4]]) {
		for (i, px) in self.buf_a.iter_mut().enumerate() {
			*px = rgbww::pack16(out[i]);
		}
		for (i, px) in self.buf_b.iter_mut().enumerate() {
			*px = rgbww::pack16(out[LINE_A + LINE_B - 1 - i]);
		}
		for (i, px) in self.buf_c.iter_mut().enumerate() {
			*px = rgbww::pack16(out[LINE_A + LINE_B + LINE_C - 1 - i]);
		}
		self.write().await;
	}

	/// The host owns gamma, so nothing here rescales.
	pub async fn present(&mut self, pixels: &[u8]) {
		let (head, rest) = pixels.split_at(pixels.len().min(LINE_A * 3));
		let (mid, tail) = rest.split_at(rest.len().min(LINE_B * 3));
		rgbww::unpack(head, &mut self.buf_a);
		rgbww::unpack_rev(mid, &mut self.buf_b);
		rgbww::unpack_rev(tail, &mut self.buf_c);
		self.write().await;
	}

	/// Together, not in sequence: one after another would cost the sum.
	async fn write(&mut self) {
		join3(self.a.write(&self.buf_a), self.b.write(&self.buf_b), self.c.write(&self.buf_c))
			.await;
		Timer::after_micros(LATCH_TOP_UP_US).await;
	}
}
