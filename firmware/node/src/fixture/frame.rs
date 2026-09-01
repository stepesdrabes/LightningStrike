use embassy_futures::join::join3;
use embassy_rp::Peripherals;
use embassy_rp::peripherals::PIO1;
use embassy_rp::pio::Pio;
use embassy_rp::pio_programs::ws2812::{PioWs2812Program, Rgbw, RgbwPioWs2812};
use embassy_time::{Duration, Timer};
use smart_leds::RGBW;

use crate::board::Board;
use crate::fixture::rgbww::{self, BLACK, LATCH_TOP_UP_US};
use crate::irq::Irqs;

pub const KIND: &str = "sk6812";

/// Where the fixture is cut between the data lines, which is where the reels are cut too.
///
/// An address is 40 us at four bytes, so 720 on one line is 28.8 ms and the room caps near 34 fps.
/// Three lines written together cost the longest of them, 12.0 ms.
const LINE_A: usize = 300;
const LINE_B: usize = 300;
const LINE_C: usize = 120;

/// The Frame: 3 x 2 m of SK6812 RGBWW at 60 LED/m, every run facing the floor.
pub struct Fixture {
	a: RgbwPioWs2812<'static, PIO1, 0, LINE_A, Rgbw>,
	b: RgbwPioWs2812<'static, PIO1, 1, LINE_B, Rgbw>,
	c: RgbwPioWs2812<'static, PIO1, 2, LINE_C, Rgbw>,
	buf_a: [RGBW<u8>; LINE_A],
	buf_b: [RGBW<u8>; LINE_B],
	buf_c: [RGBW<u8>; LINE_C],
	idle_t: u32,
}

impl Fixture {
	pub const KIND: &'static str = KIND;
	pub const HOSTNAME: &'static str = "room-frame";
	pub const PIXELS: usize = LINE_A + LINE_B + LINE_C;
	/// Three, not four. White is derived on the board, so what arrives on the wire is unchanged by
	/// this strip having a fourth emitter.
	pub const BYTES: usize = Self::PIXELS * 3;
	/// How often [`Fixture::idle`] wants to be called. One write is 12 ms, so this is about as
	/// fast as the twinkle can run.
	pub const IDLE_PERIOD: Duration = Duration::from_millis(25);

	/// GP2, GP3 and GP4, through a level shifter: the Pico drives 3.3 V and this family wants its
	/// logic high referenced to 5 V. Without one the strip usually works, which is worse than
	/// failing - it fails later, intermittently, and looks like a network fault.
	///
	/// cyw43 holds PIO0 SM0 and DMA_CH0, so the lines take PIO1 and DMA_CH2 upward. The program is
	/// loaded once and shared, so a fourth line costs a state machine and a DMA channel only.
	pub fn claim(p: Peripherals) -> (Self, Board) {
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
			idle_t: 0,
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
		(fixture, board)
	}

	/// Nothing to play. The room's boot look is the idle twinkle, which starts here and is its own
	/// wiring check: a line that never lights is a line that is not connected. The step-by-step
	/// checks live in the `bench` build.
	pub async fn selftest(&mut self) {}

	/// What the room shows while nothing is streaming at it, one frame per call.
	///
	/// Seeded by each line's offset into the fixture, so the three do not twinkle in step.
	pub async fn idle(&mut self) {
		self.idle_t = self.idle_t.wrapping_add(1);
		let gain = (self.idle_t.min(rgbww::FADE) * 256 / rgbww::FADE).min(256);
		rgbww::twinkle(&mut self.buf_a, self.idle_t, gain, 0);
		rgbww::twinkle(&mut self.buf_b, self.idle_t, gain, LINE_A as u32);
		rgbww::twinkle(&mut self.buf_c, self.idle_t, gain, (LINE_A + LINE_B) as u32);
		self.write().await;
	}

	/// The same, until something cancels it. The radio takes a second or two to join and the room
	/// should not be dark for it.
	pub async fn idle_forever(&mut self) -> ! {
		loop {
			self.idle().await;
			Timer::after(Self::IDLE_PERIOD).await;
		}
	}

	/// The host owns gamma, so nothing here rescales. The fade restarts when a show stops.
	pub async fn present(&mut self, pixels: &[u8]) {
		self.idle_t = 0;
		let (head, rest) = pixels.split_at(pixels.len().min(LINE_A * 3));
		let (mid, tail) = rest.split_at(rest.len().min(LINE_B * 3));
		rgbww::unpack(head, &mut self.buf_a);
		rgbww::unpack(mid, &mut self.buf_b);
		rgbww::unpack(tail, &mut self.buf_c);
		self.write().await;
	}

	/// Together, not in sequence: awaiting one after another costs the sum and throws away the
	/// whole reason there are three.
	async fn write(&mut self) {
		join3(self.a.write(&self.buf_a), self.b.write(&self.buf_b), self.c.write(&self.buf_c))
			.await;
		Timer::after_micros(LATCH_TOP_UP_US).await;
	}
}
