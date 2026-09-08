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

/// Where the fixture is cut between the data lines, which is where the reels are cut too: A is
/// north and east, B is south and west, C is the beam. An address is 40 us, so 720 on one line
/// would be 28.8 ms; three lines written together cost the longest of them, 12.0 ms.
const LINE_A: usize = 300;
const LINE_B: usize = 300;
const LINE_C: usize = 120;

/// The five runs where `packages/core/src/geometry.ts` puts them, at `DEFAULT_ROOM`'s 60 LED/m,
/// and what each takes in the selftest: N red, E green, S blue, W white, beam magenta. 96 is well
/// under full scale, so the whole pass draws about a quarter of what the frame can.
#[cfg(feature = "selftest")]
const RUNS: [(usize, usize, [u8; 4]); 5] = [
	(0, 180, [96, 0, 0, 0]),
	(180, 120, [0, 96, 0, 0]),
	(300, 180, [0, 0, 96, 0]),
	(480, 120, [96, 96, 96, 0]),
	(600, 120, [96, 0, 96, 0]),
];

/// The Frame: 3 x 2 m of SK6812 RGBWW at 60 LED/m, on GP2, GP3 and GP4 through the level shifter.
///
/// B and the beam are laid against the buffer. The perimeter is one loop cut in half, so its two
/// halves start at opposite corners; running B back the other way, and the beam with it, puts the
/// start of every line at the corner the board sits on. Reversed in copper and not here, the room
/// shows its own mirror image.
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
	/// One write is 12 ms, so this is about as fast as the engine can run.
	pub const ENGINE_PERIOD: Duration = Duration::from_millis(25);
	/// Restore, because this fixture hangs there all year and a midnight power blip must not
	/// relight it. Twinkle keeps the 0.1 out-of-box look.
	pub const DEFAULTS: LightState = LightState {
		on: true,
		colour: Colour::new(255, 180, 110),
		brightness: 160,
		effect: EffectKind::Twinkle,
		policy: PowerOnPolicy::Restore,
	};
	pub const EFFECTS: &'static [EffectKind] = &EffectKind::ALL;

	/// cyw43 holds PIO0 SM0 and DMA_CH0, so the lines take PIO1 and DMA_CH2 upward. The program
	/// is loaded once and shared, so a fourth line costs a state machine and a DMA channel only.
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
		};
		(fixture, board, Store { flash: p.FLASH, dma: p.DMA_CH1 })
	}

	/// Off by default the boot look is the engine's fade-in, which shows a line that is not
	/// connected but not a run that is in the wrong place. `--features selftest` paints each of the
	/// five runs its own colour for four seconds instead, which is the one look that shows a
	/// swapped pair. The measured steps live in the `bench` build.
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

	/// A range of the host's buffer, through the same flip `show` uses, so the pass tests the
	/// firmware's mapping and the copper together rather than agreeing with itself.
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
